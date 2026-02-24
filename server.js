const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const connectDB = require('./db/connect.js');
const User = require('./models/userSchema.js');
const Chat = require('./models/chatSchema.js');
const Message = require('./models/messageSchema.js');
const FriendRequest = require('./models/friendRequestSchema.js');
const Notification = require('./models/notificationSchema.js');
const Report = require('./models/reportSchema.js');
const Admin = require('./models/adminSchema.js');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
require('dotenv').config();
const { sendVerificationEmail } = require("./services/emailService");
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
//const { upload, uploadUserDp, uploadChatDp } = require('./config/CloudinaryConfig.js');
const mime = require('mime-types')
const path = require('path');
const multer = require('multer');
const { uploadBufferToR2 } = require('./config/r2.js');
const { default: mongoose } = require('mongoose');
const saltRounds = 10;

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
    fileFilter: (req, file, cb) => {
        if (!file.mimetype?.startsWith("image/")) return cb(new Error("Only images allowed"));
        cb(null, true);
    },
});

const uploadAudio = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 30 * 1024 * 1024 }, // example: 30MB (tune this)
    fileFilter: (req, file, cb) => {
        if (!file.mimetype?.startsWith("audio/")) return cb(new Error("Only audio allowed"));
        cb(null, true);
    },
});


let onlineUsers = {};
const liveViewers = new Map();

function trackViewer(chatId, userId) {
    if (!liveViewers.has(chatId)) {
        liveViewers.set(chatId, new Set());
    }

    liveViewers.get(chatId).add(userId);
}

function untrackViewer(chatId, userId) {
    if (!chatId || !userId) return;

    const viewers = liveViewers.get(chatId);
    if (!viewers) return;

    viewers.delete(userId);

    // cleanup empty rooms to prevent memory leaks
    if (viewers.size === 0) {
        liveViewers.delete(chatId);
    }
}

function emitViewerCount(chatId) {
    const count = liveViewers.get(chatId)?.size || 0;

    // who should receive the count? usually everyone watching the chat
    io.to(`chat:${chatId}:viewers`).emit('liveViewerCount', { chatId, count });
    io.to(`chat:${chatId}:members`).emit('liveViewerCount', { chatId, count });
}

const participantsCache = new Map();
const CACHE_TTL_MS = 60_000;

async function getParticipants(chatId) {
    const key = String(chatId);
    const now = Date.now();
    const cached = participantsCache.get(key);
    if (cached && cached.exp > now) return cached.participants;

    const chat = await Chat.findById(chatId).select('participants').lean();
    if (!chat) return null;

    const set = new Set(chat.participants.map(p => String(p)));
    participantsCache.set(key, { participants: set, exp: now + CACHE_TTL_MS });
    return set;
}

const app = express();
app.use(express.json());
app.use(cookieParser())
app.use(cors({
    origin: true,
    credentials: true
}))

const buildPath = path.join(__dirname, 'build');
app.use(express.static(buildPath, { maxAge: '1y', index: false }));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: true,
        methods: ['GET', 'POST'],
        credentials: true
    }
});

const messageBatches = new Map();
const BATCH_MAX = 5;
const BATCH_WINDOW_MS = 5000;

function queueMessage(chatId, msg) {
    const id = String(chatId);

    let batch = messageBatches.get(id);
    if (!batch) {
        batch = { queue: [], timer: null };
        messageBatches.set(id, batch);
    }

    batch.queue.push(msg);

    if (batch.queue.length >= BATCH_MAX) {
        flushMessages(id);
        return;
    }

    if (!batch.timer) {
        batch.timer = setTimeout(() => flushMessages(id), BATCH_WINDOW_MS);
    }
}

function flushMessages(chatId) {
    const id = String(chatId);
    const batch = messageBatches.get(id);
    if (!batch) return;

    if (batch.timer) {
        clearTimeout(batch.timer);
        batch.timer = null;
    }

    if (batch.queue.length === 0) return;

    // ✅ check if viewers room has anyone, WITHOUT using liveViewers map
    const roomName = `chat:${id}:viewers`;
    const room = io.sockets.adapter.rooms.get(roomName);
    const roomSize = room ? room.size : 0;

    if (roomSize === 0) {
        batch.queue = [];
        return;
    }

    const payload = batch.queue;
    batch.queue = [];

    io.to(roomName).emit('messagesBatch', { chatId: id, messages: payload });
}

function emitToChat(chatId, event, payload) {
    const id = String(chatId);
    io.to(`chat:${id}:members`).emit(event, payload);
    io.to(`chat:${id}:viewers`).emit(event, payload);
}

async function emitToChatParticipant(chatId, eventName, payload) {
    try {
        if (!mongoose.Types.ObjectId.isValid(chatId)) return;

        const participants = await getParticipants(chatId);
        if (!participants) return;

        participants.forEach(userId => {
            const onlineUser = onlineUsers[userId];

            if (onlineUser?.socketID) {
                io.to(onlineUser.socketID).emit(eventName, payload);
            }
        });

    } catch (err) {
        console.error('[emitToChatParticipant error]:', err);
    }
}


const authTokenAPI = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ message: 'No token provided' });

    jwt.verify(token, process.env.ACCESS_TOKEN_KEY, async (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid Token' })

        const userDB = await User.findById(user.id).select('isVerified');
        // if(!userDB.isVerified) return res.status(403).json({ message: 'User not Verified', isVerified: false })

        req.user = user;
        next();
    })
}

const authTokenSocketIO = (socket, next) => {
    const token = socket.handshake.auth.token; // token sent from frontend
    if (!token) {
        return next(new Error("No token provided"));
    }

    jwt.verify(token, process.env.ACCESS_TOKEN_KEY, (err, user) => {
        if (err) {
            return next(new Error("Invalid Token"));
        }
        socket.user = user; // attach user info to socket
        next();
    });
}

const adminAuthAPI = async (req, res, next) => {
    try {
        const token = req.cookies.adminToken; // read HttpOnly cookie
        if (!token) return res.status(401).json({ message: 'Unauthorized' });

        const decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET);
        const admin = await Admin.findById(decoded.adminId);
        if (!admin) return res.status(401).json({ message: 'Unauthorized' });

        req.admin = admin;
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
}

io.use(authTokenSocketIO);

app.get(/^(?!\/api|\/socket\.io).*/, (req, res) => {
    res.sendFile(path.join(buildPath, 'index.html'));
});

app.post("/api/signup", async (req, res) => { 
    try {
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

        const user = {
            firstName: req.body.firstName,
            lastName: req.body.lastName,
            username: req.body.username,
            email: req.body.email,
            password_hash: await bcrypt.hash(req.body.password, saltRounds),
            verificationCode,
            verificationExpires: Date.now() + 1000 * 60 * 60,
        };

        const userDB = await User.create(user);

        await Notification.create({
            user: userDB._id,
            sender: process.env.COHORT_ROOT_USER_ID,
            type: "welcome",
            chat: null,
            message: null,
            text: "",
            isRead: false,
        });

        // ✅ email logic moved to service (same behavior)
        const emailRes = await sendVerificationEmail({
            toEmail: user.email,
            toName: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
            code: verificationCode,
        });

        if(!emailRes.ok){
            throw new Error(emailRes);
        }

        const payload = {
            id: userDB._id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            username: user.username,
        };

        const accessToken = jwt.sign(payload, process.env.ACCESS_TOKEN_KEY, { expiresIn: "10m" });
        const refreshToken = jwt.sign(payload, process.env.REFRESH_TOKEN_KEY, { expiresIn: "7d" });

        res.cookie("refreshToken", refreshToken, {
            httpOnly: true,
            secure: false,
            sameSite: "lax",
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        return res.status(201).json({ accessToken });
    } catch (err) {
        console.log(err);

        if (err.code === 11000) {
            return res.status(400).json({ message: "Email already exists" });
        }

        return res.status(500).json({ message: "Server error" });
    }
});

app.post('/api/update-verification-token', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ message: "Email is required" });
        }

        const user = await User.findOne({ email });

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

        user.verificationCode = verificationCode;
        user.verificationExpires = Date.now() + 1000 * 60 * 10;

        await user.save();

        const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        // Email content
        const mailOptions = {
            from: '"Cohort-Box" <no-reply@cohortbox.com>',
            to: email,
            subject: "Your New CohortBox Verification Code",
            html: `
                <h2>Your New Verification Code</h2>
                <h1 style="font-size: 40px; font-weight: bold; letter-spacing: 6px;">${verificationCode}</h1>
                <p>This code will expire in 10 minutes.</p>
            `
        };

        await transporter.sendMail(mailOptions);

        return res.status(200).json({
            message: "Verification code sent successfully",
            codeSent: true
        });

    } catch (err) {
        console.log(err)
        return res.status(500).json({ message: 'Server error' });
    }
})

app.get('/api/refresh', (req, res) => {
    console.log("Access Token refresh request!");
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
        console.log("Refresh Token not found!");
        return res.status(401).json({ message: 'No refresh token' });
    }

    jwt.verify(refreshToken, process.env.REFRESH_TOKEN_KEY, (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid refresh token' });

        // remove exp and iat from the decoded user object
        const { exp, iat, ...payload } = user;

        const accessToken = jwt.sign(
            payload,
            process.env.ACCESS_TOKEN_KEY,
            { expiresIn: "10m" }
        );

        res.json({ accessToken });
    });
});

app.post('/api/login', async (req, res) => {
    try {
        const user = await User.findOne({ email: req.body.email });

        if (!user) {
            return res.status(404).json({ message: "No user found against this email!" });
        }

        // ✅ BLOCK deleted/banned/warned users
        if (user.status === 'deleted' || user.status === 'banned') {
            return res.status(403).json({
                message: user.status === 'deleted'
                    ? 'This account has been deleted.'
                    : 'This account is not allowed to login.'
            });
        }

        // ✅ password check
        const isMatch = await bcrypt.compare(req.body.password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid Credentials!' });
        }

        const payload = {
            id: user._id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            username: user.username
        };

        const accessToken = jwt.sign(payload, process.env.ACCESS_TOKEN_KEY, { expiresIn: "10m" });
        const refreshToken = jwt.sign(payload, process.env.REFRESH_TOKEN_KEY, { expiresIn: "7d" });

        res.cookie("refreshToken", refreshToken, {
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
            path: '/'
        });

        if (req.headers["x-client"] === "mobile") {
            return res.status(200).json({ accessToken, refreshToken });
        }

        return res.status(200).json({ accessToken });

    } catch (err) {
        console.log(err);
        return res.status(500).json({ message: 'Server Error!' });
    }
});

app.post('/api/admin/auth/login', async (req, res) => {
    const { email, password } = req.body;

    const admin = await Admin.findOne({ email, active: true });
    if (!admin) {
        return res.status(401).json({ message: 'Invalid credentials' });
    }

    const ok = await bcrypt.compare(password, admin.password);
    if (!ok) {
        return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
        { adminId: admin._id },
        process.env.ADMIN_JWT_SECRET,
        { expiresIn: '2h' }
    );

    res.cookie('adminToken', token, {
        httpOnly: true,      // cannot be accessed by JS
        secure: false, // HTTPS only in production
        sameSite: 'Strict',  // or 'None' if using cross-origin
        maxAge: 2 * 60 * 60 * 1000 // 2 hours
    });

    res.json({ message: 'Login successful' });

});

app.get('/api/admin/auth/me', async (req, res) => {
    const token = req.cookies.adminToken;

    if (!token) {
        return res.status(401).json({ message: 'Not authenticated' });
    }

    try {
        const decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET);
        const admin = await Admin.findById(decoded.adminId);

        if (!admin || !admin.active) {
            return res.status(401).json({ message: 'Invalid admin' });
        }

        res.status(200).json({ ok: true });
    } catch {
        res.status(401).json({ message: 'Invalid token' });
    }
});

app.get('/api/admin/reports', adminAuthAPI, async (req, res) => {
    try {
        // req.admin is already set by middleware
        const reports = await Report.find({ status: 'pending' })
            .populate('from', 'email username firstName lastName')   // reporter email
            .populate({
                path: 'target',
                populate: [
                    {
                        path: 'from',
                        select: 'email username firstName lastName dp',
                        strictPopulate: false
                    },
                    {
                        path: 'chatId',
                        select: '_id chatName',
                        strictPopulate: false
                    }
                ]
            })         // optional target data
            .sort({ createdAt: 1 });

        const formattedReports = reports.map(r => ({
            _id: r._id,
            fromUser: r.from,
            targetType: r.targetModel,
            target: r.target,
            reason: r.reason || 'No reason provided',
            createdAt: r.createdAt,
        }));

        res.json({ reports: formattedReports });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error fetching reports' });
    }
});

app.post('/api/admin/report/action/:reportId/:action', adminAuthAPI, async (req, res) => {
    try {
        const action = req.params.action;
        if (action !== 'del' && action !== 'warn' && action !== 'dismiss') {
            return res.status(400).json({ message: 'Invalid Action!' });
        }
        const reportId = req.params.reportId;
        if (!mongoose.Types.ObjectId.isValid(reportId)) {
            return res.status(400).json({ success: false, message: 'Invalid report ID' });
        }
        const report = await Report.findById(reportId);
        if (!report) {
            return res.status(404).json({ success: false, message: "Report not found 404!" })
        }
        if (report.targetModel !== 'Message' && report.targetModel !== 'User') {
            return res.status(400).json({
                success: false,
                message: 'Invalid report target'
            });
        }
        if (report.resolved) {
            return res.status(409).json({
                success: false,
                message: 'Report already resolved'
            });
        }
        if (action === 'del') {
            if (report.targetModel === 'User') {
                const bannedUser = await User.updateOne({ _id: report.target }, { status: 'banned' });
                if (bannedUser.matchedCount === 0) {
                    return res.status(404).json({ success: false, message: "User Wasn't banned!" })
                }
            }
            if (report.targetModel === 'Message') {
                const deletedMessage = await Message.deleteOne({ _id: report.target });
                if (deletedMessage.deletedCount === 0) {
                    return res.status(404).json({ success: false, message: "Message Wasn't deleted!" })
                }
            }
            report.resolved = true;
            report.status = 'actioned';
            await report.save();
            return res.status(200).json({ success: true });
        }
        if (action === 'warn') {
            if (report.targetModel === 'User') {
                const bannedUser = await User.updateOne({ _id: report.target }, { status: 'warned' });
                if (bannedUser.matchedCount === 0) {
                    return res.status(404).json({ success: false, message: "User Wasn't banned!" })
                }
            }

            if (report.targetModel === 'Message') {
                const reportedMessage = await Message.findById(report.target);
                if (!reportedMessage) {
                    return res.status(404).json({ success: false, message: "Reported Message Could not be found" })
                }
                const reportedUser = await User.updateOne({ _id: reportedMessage.from }, { status: 'warned' });
                if (reportedUser.matchedCount === 0) {
                    return res.status(404).json({ success: false, message: "User Wasn't warned" });
                }
            }
            report.resolved = true;
            report.status = 'actioned';
            await report.save();
            return res.status(200).json({ success: true });
        }
        if (action === 'dismiss') {
            report.resolved = true;
            report.status = 'dismissed';
            await report.save();
            return res.status(200).json({ success: true });
        }
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Server Error!' });
    }
});

app.post('/api/logout', authTokenAPI, (req, res) => {
    res.clearCookie('refreshToken', {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/'
    })
    return res.status(200).json({ message: 'Logged out successfully' });
});

app.post('/api/verify-code', async (req, res) => {
    try {
        const email = req.body.email?.toLowerCase().trim();
        const code = req.body.code?.toString().trim();

        if (!email || !code) {
            return res.status(400).json({
                message: "Email & code are required",
                verified: false
            });
        }

        const user = await User.findOne({
            email,
            verificationCode: code,
            verificationExpires: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({
                message: 'Invalid or expired token.',
                verified: false
            });
        }

        // Mark email as verified
        user.isVerified = true;
        user.verificationCode = undefined;
        user.verificationExpires = undefined;

        await user.save();

        return res.status(200).json({
            message: 'Email verified!',
            verified: true
        });

    } catch (err) {
        return res.status(500).json({
            message: 'Internal Server Error!',
            verified: false
        });
    }
});

app.get('/api/check-username', async (req, res) => {
    try {
        const usernameRaw = (req.query.username || '').trim();

        if (!usernameRaw) {
            return res.status(400).json({
                available: false,
                reason: 'username_required',
            });
        }

        // normalize for checking
        const username = usernameRaw.toLowerCase();

        // basic validation (tune rules to your liking)
        if (username.length < 3 || username.length > 20) {
            return res.status(400).json({
                available: false,
                reason: 'invalid_length',
            });
        }

        // allow letters, numbers, underscore, dot (example)
        if (!/^[a-z0-9._]+$/.test(username)) {
            return res.status(400).json({
                available: false,
                reason: 'invalid_characters',
            });
        }

        // IMPORTANT: use normalized field (recommended) OR do a case-insensitive exact match
        // Option A (recommended): if you add usernameLower in schema
        // const exists = await User.exists({ usernameLower: username });

        // Option B (works without schema changes but is slower):
        const exists = await User.exists({
            username: { $regex: `^${escapeRegex(usernameRaw)}$`, $options: 'i' }
        });

        if (exists) {
            return res.status(200).json({
                available: false,
                reason: 'taken',
                // optional suggestions
                suggestions: [
                    `${username}1`,
                    `${username}__`,
                    `${username}.${Math.floor(Math.random() * 900 + 100)}`
                ],
            });
        }

        return res.status(200).json({
            available: true,
            reason: 'available',
        });
    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: 'Internal Server Error!',
            available: false,
        });
    }
});

app.get('/api/check-chatname', authTokenAPI, async (req, res) => {
    try {
        console.log('check-chatname')
        const chatnameRaw = (req.query.chatname || '').trim();

        if (!chatnameRaw) {
            return res.status(400).json({
                available: false,
                reason: 'chatname_required',
            });
        }

        // normalize for checking
        const chatname = chatnameRaw.toLowerCase();

        // basic validation (tune rules to your liking)
        if (chatname.length < 3 || chatname.length > 20) {
            return res.status(400).json({
                available: false,
                reason: 'invalid_length',
            });
        }

        // allow letters, numbers, underscore, dot (example)
        if (!/^[a-z0-9._]+$/.test(chatname)) {
            return res.status(400).json({
                available: false,
                reason: 'invalid_characters',
            });
        }

        // IMPORTANT: use normalized field (recommended) OR do a case-insensitive exact match
        // Option A (recommended): if you add usernameLower in schema
        // const exists = await User.exists({ usernameLower: username });

        // Option B (works without schema changes but is slower):
        const exists = await Chat.exists({
            uniqueChatName: { $regex: `^${escapeRegex(chatnameRaw)}$`, $options: 'i' }
        });

        if (exists) {
            return res.status(200).json({
                available: false,
                reason: 'taken'
            });
        }

        return res.status(200).json({
            available: true,
            reason: 'available',
        });
    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: 'Internal Server Error!',
            available: false,
        });
    }
});

app.get('/api/forgot-password/user/:email', async (req, res) => {
    try {
        const email = req.body.email.trim();

        // Always return success (prevents email enumeration)
        if (!email) {
            return res.status(200).json({
                success: true,
                message: 'If an account exists, a reset code has been sent.'
            });
        }

        const user = await User.findOne({ email });

        if (user) {
            // 6-digit numeric code (same UX style as signup)
            const passwordChangeCode = Math.floor(
                100000 + Math.random() * 900000
            ).toString();

            user.passwordChangeCode = passwordChangeCode;
            user.passwordChangeExpires = Date.now() + 1000 * 60 * 15; // 15 minutes

            await user.save();

            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: process.env.EMAIL_USER,
                    pass: process.env.EMAIL_PASS
                }
            });

            const mailOptions = {
                from: '"Cohort-Box" <no-reply@cohortbox.com>',
                to: user.email,
                subject: 'CohortBox Password Reset Code',
                html: `
                <h3>Password Reset Request</h3>
                <p>Use the code below to reset your password:</p>

                <h2 style="font-size: 32px; letter-spacing: 4px;">
                    ${passwordChangeCode}
                </h2>

                <p>This code expires in <strong>15 minutes</strong>.</p>
                <p>If you did not request a password reset, you can safely ignore this email.</p>
                `
            };

            await transporter.sendMail(mailOptions);
        }

        // Always respond the same
        return res.status(200).json({
            success: true,
            message: 'If an account exists, a reset code has been sent.'
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
})

app.post('/api/forgot-password/verify-code', async (req, res) => {
    try {
        const { email, passwordChangeCode } = req.body;

        if (!email || !passwordChangeCode) {
            return res.status(400).json({
                message: "Email and code are required",
                verified: false
            });
        }

        const user = await User.findOne({
            email,
            passwordChangeCode,
            passwordChangeExpires: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({
                message: "Invalid or expired code",
                verified: false
            });
        }

        // Generate secure reset token
        const resetToken = crypto.randomBytes(32).toString('hex');

        // Store hashed version for security
        user.passwordResetToken = crypto
            .createHash('sha256')
            .update(resetToken)
            .digest('hex');

        user.passwordResetExpires = Date.now() + 1000 * 60 * 15; // 15 minutes

        // Invalidate verification code
        user.passwordChangeCode = undefined;
        user.passwordChangeExpires = undefined;

        await user.save();

        return res.status(200).json({
            verified: true,
            resetToken
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            message: "Internal Server Error",
            verified: false
        });
    }
});

app.post('/api/forgot-password/update-password-change-code', async (req, res) => {
    try {
        const email = req.body.email?.toLowerCase().trim();

        // Always return success (prevents enumeration)
        if (!email) {
            return res.status(200).json({
                success: true,
                message: 'If an account exists, a reset code has been sent.'
            });
        }

        const user = await User.findOne({ email });

        if (user) {
            const passwordChangeCode = Math.floor(
                100000 + Math.random() * 900000
            ).toString();

            user.passwordChangeCode = passwordChangeCode;
            user.passwordChangeExpires = Date.now() + 1000 * 60 * 15; // 15 minutes

            await user.save();

            try {
                const transporter = nodemailer.createTransport({
                    service: 'gmail',
                    auth: {
                        user: process.env.EMAIL_USER,
                        pass: process.env.EMAIL_PASS
                    }
                });

                const mailOptions = {
                    from: '"Cohort-Box" <no-reply@cohortbox.com>',
                    to: email,
                    subject: 'CohortBox Password Reset Code',
                    html: `
            <h3>Password Reset Request</h3>
            <p>Use the code below to reset your password:</p>
            <h2 style="font-size: 32px; letter-spacing: 4px;">${passwordChangeCode}</h2>
            <p>This code expires in <strong>15 minutes</strong>.</p>
            <p>If you did not request a password reset, you can safely ignore this email.</p>
          `
                };

                await transporter.sendMail(mailOptions);
            } catch (mailErr) {
                console.error('Failed to send reset code email:', mailErr);
                // Do NOT fail the request, still return success to prevent enumeration
            }
        }

        return res.status(200).json({
            success: true,
            message: 'If an account exists, a reset code has been sent.'
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Server error' });
    }
});

app.post('/api/forgot-password/reset', async (req, res) => {
    try {
        const { resetToken, password } = req.body;

        if (!resetToken || !password) {
            return res.status(400).json({
                message: 'Reset token and new password are required'
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                message: 'Password must be at least 8 characters long'
            });
        }

        // Hash incoming reset token to compare with DB
        const hashedToken = crypto
            .createHash('sha256')
            .update(resetToken)
            .digest('hex');

        const user = await User.findOne({
            passwordResetToken: hashedToken,
            passwordResetExpires: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({
                message: 'Invalid or expired reset token'
            });
        }

        // Update password
        user.password_hash = await bcrypt.hash(password, saltRounds);

        // Invalidate reset token
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;

        await user.save();

        return res.status(200).json({
            success: true,
            message: 'Password reset successful'
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            message: 'Internal Server Error'
        });
    }
});

function escapeRegex(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

app.get('/api/search', authTokenAPI, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(400).json({ message: 'User ID not found in request!' });
        }

        const rawQuery = (req.query.q || '').trim();
        if (rawQuery.length < 2 || rawQuery.length > 50) {
            return res.status(400).json({ message: 'Invalid search query' });
        }

        // Escape regex special characters
        const query = rawQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const LIMIT = 10;

        const userFilter = {
            _id: { $ne: userId },
            $or: [
                { username: { $regex: `${query}`, $options: 'i' } },
                { firstName: { $regex: `^${query}`, $options: 'i' } },
                { lastName: { $regex: `^${query}`, $options: 'i' } }
            ]
        };

        const chatFilter = {
            chatName: { $regex: `^${query}`, $options: 'i' },
            status: 'active'
        };

        const [users, chats] = await Promise.all([
            User.find(userFilter)
                .select('_id username firstName lastName dp')
                .limit(LIMIT)
                .lean(),
            Chat.find(chatFilter)
                .select('_id chatName participants subscribers chatDp')
                .limit(LIMIT)
                .lean()
        ]);

        return res.status(200).json({ users, chats });
    } catch (err) {
        console.error('[Search API error]:', err);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
});

app.get('/api/notification', authTokenAPI, async (req, res) => {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(400).json({ message: 'User ID not found in request!' });
        }

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ message: 'Invalid user ID' });
        }

        const userObjectId = new mongoose.Types.ObjectId(userId);

        // ✅ Then fetch notifications
        const notifications = await Notification.find({ user: userObjectId })
            .sort({ createdAt: -1 }) // optional but recommended
            .populate('sender', '_id firstName lastName username dp')
            .populate('chat', '_id chatName chatAdmin chatDp')
            .populate('message', '_id message type')
            .lean();


        // ✅ Mark all unread notifications as read
        await Notification.updateMany(
            { user: userObjectId, isRead: false },
            { $set: { isRead: true } }
        );

        return res.status(200).json({ notifications });

    } catch (error) {
        console.error('[Get notifications error]:', error);
        return res.status(500).json({ message: 'Internal Server Error!' });
    }
});

app.delete('/api/notification/:notificationId', authTokenAPI, async (req, res) => {
    try {
        const { notificationId } = req.params;
        const userId = req.user.id;

        // 1. Validate ObjectId
        if (!mongoose.Types.ObjectId.isValid(notificationId)) {
            return res.status(400).json({ message: 'Invalid notification ID!' });
        }

        // 2. Find notification
        const notification = await Notification.findById(notificationId).select('user');
        if (!notification) {
            return res.status(404).json({ message: 'Notification not found!' });
        }

        // 3. Authorization check
        if (String(notification.user) !== String(userId)) {
            return res.status(403).json({ message: 'Not authorized to delete this notification!' });
        }

        // 4. Delete notification
        await Notification.deleteOne({ _id: notificationId });
        console.log('Notification Deleted: ', notificationId);
        return res.status(200).json({ message: 'Notification deleted successfully!' });

    } catch (err) {
        console.error('Delete notification error:', err);
        return res.status(500).json({ message: 'Internal Server Error!' });
    }
});

app.get('/api/users', authTokenAPI, async (req, res) => {
    try {
        const lastId = req.query.lastId;
        const query = (req.query.q || '').trim();
        const limit = Math.min(Number(req.query.limit) || 30, 200);

        if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
            return res.status(400).json({ message: 'Invalid user ID' });
        }

        const filter = { _id: { $ne: req.user.id }, $or: [{ status: 'active' }, { status: 'warned' }] };

        // Search by name if query exists
        if (query) {
            filter.$or = [
                { firstName: { $regex: query, $options: 'i' } },
                { lastName: { $regex: query, $options: 'i' } }
            ];
        }

        // Defensive check for lastId
        if (lastId) {
            if (!mongoose.Types.ObjectId.isValid(lastId)) {
                return res.status(400).json({ message: 'Invalid lastId!' });
            }
            filter._id.$lt = new mongoose.Types.ObjectId(lastId);
        }

        const users = await User.find(filter)
            .select('_id firstName lastName dp username')
            .populate('friends', '_id firstName lastName dp username')
            .sort({ _id: -1 })
            .limit(limit)
            .lean();

        res.status(200).json({ users });
    } catch (err) {
        console.error('[Get users error]:', err);
        res.status(500).json({ message: 'Server Error!' });
    }
});

app.get('/api/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        // 1. Validate ObjectId
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ message: 'Invalid user ID' });
        }

        // 2. Fetch user with controlled fields only
        const userDB = await User.findById(userId)
            .select('_id firstName lastName username dp friends about')
            .populate('friends', '_id firstName lastName username dp')
            .lean();

        // 3. Handle not found
        if (!userDB) {
            return res.status(404).json({ message: 'User not found' });
        }

        // 4. Defensive defaults
        userDB.friends = userDB.friends || [];

        // 5. Respond
        res.status(200).json({ userDB });

    } catch (err) {
        console.error('GET /api/user/:userId error:', err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

app.get('/api/user-dp', authTokenAPI, async (req, res) => {
    try {
        const userId = req.user.id;
        if (!mongoose.isValidObjectId(userId)) {
            return res.status(400).json({ message: 'Invalid User ID!' });
        }
        const user = await User.findById(userId).select('dp');
        if (!user) {
            return res.status(404).json({ message: 'No User Found!' });
        }
        return res.status(200).json({ dp: user.dp });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: 'Internal Server Error!' })
    }
})

app.get('/api/friends', authTokenAPI, async (req, res) => {
    try {
        const id = req.user.id;
        const query = (req.query.q || '').trim();

        // Validate that the ID is a valid MongoDB ObjectId
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Invalid user ID' });
        }

        // Fetch user's friends IDs
        const user = await User.findById(id).select('friends').lean();
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        let friendsQuery = { _id: { $in: user.friends } };

        // If search query exists, filter by username, firstName, or lastName
        if (query) {
            friendsQuery.$or = [
                { username: { $regex: query, $options: 'i' } },
                { firstName: { $regex: query, $options: 'i' } },
                { lastName: { $regex: query, $options: 'i' } },
            ];
        }

        const friends = await User.find(friendsQuery)
            .select('_id firstName lastName username dp')
            .lean();

        res.status(200).json({ friends: friends || [] });
    } catch (err) {
        console.error('return-friends/:id error:', err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

app.get('/api/friends/:id', authTokenAPI, async (req, res) => {
    try {
        const { id } = req.params;

        // Validate that the ID is a valid MongoDB ObjectId
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Invalid user ID' });
        }

        const user = await User.findById(id)
            .select('friends')
            .populate('friends', '_id firstName lastName username avatar')
            .lean();

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Always return an array
        res.status(200).json({
            friends: user.friends || [],
        });
    } catch (err) {
        console.error('return-friends/:id error:', err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

app.get('/api/friend-requests', authTokenAPI, async (req, res) => {
    try {
        const userId = req?.user?.id;

        // Production hardening: validate auth context
        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        // Production hardening: validate ObjectId (prevents cast errors / weird queries)
        // If your IDs are NOT Mongo ObjectIds, remove this check.
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ message: "Invalid user id" });
        }

        // Keep original query + sorting + populates + lean
        const requests = await FriendRequest.find({
            $or: [{ from: userId }, { to: userId }],
        })
            .sort({ createdAt: -1 })
            .select("_id from to status createdAt updatedAt") // production hardening: return only needed fields
            .populate("from", "_id firstName lastName username")
            .populate("to", "_id firstName lastName username")
            .lean({ virtuals: false }); // avoid accidental virtual expansion

        return res.status(200).json({ requests });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server Error!' });
    }
});

app.get('/api/posts', authTokenAPI, async (req, res) => {
    try {
        const { lastId } = req.query;
        const limit = 30;
        const filter = { type: 'media' };

        // Validate lastId if provided
        if (lastId) {
            if (!mongoose.Types.ObjectId.isValid(lastId)) {
                return res.status(400).json({ message: 'Invalid lastId!' });
            }
            filter._id = { $lt: new mongoose.Types.ObjectId(lastId) };
        }

        const posts = await Message.find(filter)
            .sort({ _id: -1 })
            .populate('from', '_id firstName lastName')
            .populate('chatId', '_id chatName chatDp')
            .limit(limit)
            .lean(); // optional, improves performance if no Mongoose methods needed

        if (posts.length === 0) {
            return res.status(200).json({ posts: [] });
        }

        return res.status(200).json({ posts });
    } catch (err) {
        console.error('[Get posts error]:', err);
        return res.status(500).json({ message: 'Server Error!' });
    }
});

app.get('/api/chats', authTokenAPI, async (req, res) => {
    const { lastId } = req.query;
    const limit = 30;
    let filter = {};

    try {
        // Validate lastId only if present
        if (lastId) {
            if (!mongoose.Types.ObjectId.isValid(lastId)) {
                console.warn('[GET /api/chats] INVALID_LAST_ID', lastId);
                return res.status(400).json({ message: 'Invalid lastId!' });
            }
            filter._id = { $lt: lastId };
        }

        const chats = await Chat.find(filter)
            .sort({ _id: -1 })
            .populate('participants', '_id firstName lastName username dp')
            .populate('liveComments.from', '_id username')
            .limit(limit)
            .lean({ defaults: true });

        if (chats.length === 0) {
            return res.status(200).json({ chats: [] });
        }

        const chatsWithViewers = chats.map(chat => {
            const chatId = chat._id?.toString();
            const count = chatId && liveViewers.has(chatId)
                ? liveViewers.get(chatId).size
                : 0;

            return {
                ...chat,
                liveViewerCount: count
            };
        });

        return res.status(200).json({ chats: chatsWithViewers });

    } catch (err) {
        console.error('[GET /api/chats] SERVER_ERROR', err);
        return res.status(500).json({ message: 'Server Error!' });
    }
});

app.get('/api/subscribed-chats', authTokenAPI, async (req, res) => {
    try {
        const userId = req.user.id;
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ message: 'Invalid userId!' });
        }

        const { lastId } = req.query;
        const limit = 30;

        const filter = {
            subscribers: new mongoose.Types.ObjectId(userId),
        };

        if (lastId) {
            if (!mongoose.Types.ObjectId.isValid(lastId)) {
                console.warn('[GET /api/subscribed-chats] INVALID_LAST_ID', lastId);
                return res.status(400).json({ message: 'Invalid lastId!' });
            }
            filter._id = { $lt: new mongoose.Types.ObjectId(lastId) };
        }

        const chats = await Chat.find(filter)
            .sort({ _id: -1 })
            .populate('participants', '_id firstName lastName username dp')
            .populate('liveComments.from', '_id username')
            .limit(limit)
            .lean({ defaults: true });

        const chatsWithViewers = chats.map(chat => {
            const chatId = String(chat._id);
            const count = liveViewers?.has(chatId) ? liveViewers.get(chatId).size : 0;
            return { ...chat, liveViewerCount: count };
        });

        return res.status(200).json({ chats: chatsWithViewers });
    } catch (err) {
        console.error('[GET /api/subscribed-chats] SERVER_ERROR', err);
        return res.status(500).json({ message: 'Server Error!' });
    }
});

app.get('/api/chats/:id', authTokenAPI, async (req, res) => {
    const { id } = req.params;
    console.log('[GET /api/chats/:id] REQUEST', id);

    try {
        // Prevent BSON crash on invalid ObjectId
        if (!mongoose.Types.ObjectId.isValid(id)) {
            console.warn('[GET /api/chats/:id] INVALID_CHAT_ID', id);
            return res.status(400).json({ message: 'Invalid chat id!' });
        }

        const chat = await Chat.findById(id)
            .populate('participants', '_id firstName lastName username dp')
            .populate('liveComments.from', '_id username')
            .lean();

        if (!chat) {
            return res.status(404).json({ message: 'No chats found!' });
        }

        const chatId = chat._id;
        const count =
            chatId && liveViewers.has(chatId)
                ? liveViewers.get(chatId).size
                : 0;

        return res.status(200).json({
            chat: {
                ...chat,
                liveViewerCount: count
            }
        });

    } catch (err) {
        console.error('[GET /api/chats/:id] SERVER_ERROR', err);
        return res.status(500).json({ message: 'Server Error!' });
    }
});

app.get('/api/user-chats/:id', authTokenAPI, async (req, res) => {
    const { id } = req.params;
    const { lastId } = req.query;
    const limit = 30;

    console.log('[GET /api/user-chats/:id] REQUEST', id);

    try {
        // Validate user id
        if (!mongoose.Types.ObjectId.isValid(id)) {
            console.warn('[GET /api/user-chats/:id] INVALID_USER_ID', id);
            return res.status(400).json({ message: 'Invalid user id!' });
        }

        const userObjectId = new mongoose.Types.ObjectId(id);

        const filter = {
            $or: [
                { chatAdmin: userObjectId },
                { participants: userObjectId }
            ]
        };

        // Pagination
        if (lastId) {
            if (!mongoose.Types.ObjectId.isValid(lastId)) {
                console.warn('[GET /api/user-chats/:id] INVALID_LAST_ID', lastId);
                return res.status(400).json({ message: 'Invalid lastId!' });
            }

            filter._id = { $lt: new mongoose.Types.ObjectId(lastId) };
        }

        const chats = await Chat.find(filter)
            .sort({ _id: -1 })
            .populate('participants', '_id firstName lastName username dp')
            .populate('liveComments.from', '_id username')
            .limit(limit)
            .lean({ defaults: true });

        return res.status(200).json({ chats });

    } catch (err) {
        console.error('[GET /api/user-chats/:id] SERVER_ERROR', err);
        return res.status(500).json({ message: 'Server Error!' });
    }
});

app.get('/api/messages/:chatId', authTokenAPI, async (req, res) => {
    try {
        console.log('return-msgs');
        const { chatId } = req.params;
        const limit = Math.min(parseInt(req.query.limit || '10', 10), 100);
        const { before } = req.query; // message _id cursor (oldest currently loaded)

        const filter = { chatId };

        // If before is provided, load messages older than that _id
        if (before) {
            filter._id = { $lt: before };
        }

        // Fetch newest -> oldest for pagination efficiency
        let query = Message.find(filter)
            .sort({ _id: -1 }) // newest first
            .limit(limit)
            .populate('from', '_id firstName lastName username dp')
            .lean();

        // Optionally populate repliedTo if isReply is true
        // Mongoose populate works even if field is null, so safe to populate always
        query = query.populate({
            path: 'repliedTo',
            populate: { path: 'from', select: '_id firstName lastName dp' }, // populate sender of repliedTo
        });

        const msgs = await query;

        // Determine if there are more older messages
        let hasMore = false;
        if (msgs.length === limit) {
            const last = msgs[msgs.length - 1]; // oldest in this batch (because sorted desc)
            const olderExists = await Message.exists({ chatId, _id: { $lt: last._id } });
            hasMore = !!olderExists;
        }

        res.status(200).json({ msgs, hasMore });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: 'Server Error!' });
    }
});

app.get("/api/participant-reaction/:msgId", authTokenAPI, async (req, res) => {
    try {
        const { msgId } = req.params;
        const requesterId = String(req.user.id);

        if (!mongoose.Types.ObjectId.isValid(msgId)) {
            return res.status(400).json({ message: "Invalid messageId" });
        }

        // 1️⃣ Find message
        const message = await Message.findById(msgId)
            .select("chatId reactions")
            .populate("reactions.userId", "_id username")
            .lean();

        if (!message) {
            return res.status(404).json({ message: "Message not found" });
        }

        // 2️⃣ Get participants using your cache function
        const participantsSet = await getParticipants(message.chatId);
        if (!participantsSet) {
            return res.status(404).json({ message: "Chat not found" });
        }

        // 4️⃣ Filter reactions to only participants
        const filteredReactions = message.reactions
            .filter(r => {
                const uid = r.userId?._id
                    ? String(r.userId._id)
                    : String(r.userId);
                return participantsSet.has(uid);
            })
            .map(r => ({
                userId: {
                    _id: r.userId._id,
                    username: r.userId.username
                },
                emoji: r.emoji
            }));

        return res.status(200).json({
            messageId: msgId,
            reactions: filteredReactions
        });

    } catch (err) {
        console.error("participant-reaction error:", err);
        return res.status(500).json({ message: "Internal Server Error" });
    }
});

app.delete('/api/message/:msgId', authTokenAPI, async (req, res) => {
    try {
        const userId = req.user.id;
        const msgId = req.params.msgId;
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ message: 'Invalid User ID' });
        }

        if (!mongoose.Types.ObjectId.isValid(msgId)) {
            return res.status(400).json({ message: 'Invalid Message ID' });
        }

        const deletedMessage = await Message.deleteOne({ _id: msgId, from: userId });

        if (deletedMessage.deletedCount === 0) {
            return res.status(400).json({ message: "Couldn't delete message" });
        }

        return res.status(200).json({ message: 'Message deleted Successfully!' });

    } catch (err) {
        console.log(err);
        return res.status(500).json({ message: 'Server Error!' })
    }
});

app.get('/api/user', authTokenAPI, async (req, res) => {
    try {
        // Validate user ID
        if (!req.user.id || !mongoose.Types.ObjectId.isValid(req.user.id)) {
            return res.status(400).json({ message: 'Got no valid User ID!' });
        }

        const userId = new mongoose.Types.ObjectId(req.user.id);

        // Fetch user
        const user = await User.findById(userId)
            .select('_id firstName lastName dp username about')
            .lean();

        if (!user) {
            return res.status(404).json({ message: 'No User Found!' });
        }

        return res.status(200).json({ user });
    } catch (err) {
        console.error('[Get user error]:', err);
        return res.status(500).json({ message: 'Server Error!' });
    }
})

app.patch('/api/user/display-name', authTokenAPI, async (req, res) => {
    try {
        const { firstName, lastName } = req.body;

        // Validate input presence
        if (!firstName || !firstName.trim() || !lastName || !lastName.trim()) {
            return res.status(400).json({
                message: 'First name and last name are required'
            });
        }

        // Validate user ID
        if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
            return res.status(400).json({ message: 'Invalid user ID' });
        }

        // Update user
        const updatedUser = await User.findByIdAndUpdate(
            req.user.id,
            {
                firstName: firstName.trim(),
                lastName: lastName.trim(),
            },
            {
                new: true,
                runValidators: true,
            }
        ).select('_id firstName lastName username dp about');

        if (!updatedUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        return res.status(200).json({
            message: 'Display name updated successfully',
            user: updatedUser,
        });
    } catch (err) {
        console.error('[Display name update error]:', err);
        res.status(500).json({ message: 'Server Error!' });
    }
});

app.patch('/api/user/about', authTokenAPI, async (req, res) => {
    try {
        const { about } = req.body;

        // Validate input presence
        if (!about || !about.trim()) {
            return res.status(400).json({ message: 'About field is required' });
        }

        // Validate length
        if (about.length > 120) {
            return res.status(400).json({ message: 'About must be 120 characters or less' });
        }

        // Validate user ID
        if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
            return res.status(400).json({ message: 'Invalid user ID' });
        }

        // Update user about
        const updatedUser = await User.findByIdAndUpdate(
            req.user.id,
            { about: about.trim() },
            { new: true, runValidators: true }
        ).select('_id firstName lastName username dp about');

        if (!updatedUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        return res.status(200).json({
            message: 'About updated successfully',
            user: updatedUser,
        });

    } catch (err) {
        console.error('[About update error]:', err);
        return res.status(500).json({ message: 'Server Error!' });
    }
});

app.patch('/api/user/password', authTokenAPI, async (req, res) => {
    try {
        const currentPassword = req.body.currentPassword?.trim();
        const newPassword = req.body.newPassword?.trim();

        // Validate input presence
        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                message: 'Current and new passwords are required',
            });
        }

        // Validate new password length
        if (newPassword.length < 8) {
            return res.status(400).json({
                message: 'Password must be at least 8 characters long',
            });
        }

        // Validate user ID
        if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
            return res.status(400).json({ message: 'Invalid user ID' });
        }

        // Fetch user with password hash
        const user = await User.findById(req.user.id).select('+password_hash');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Compare current password
        const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ message: 'Current password is incorrect' });
        }

        // Hash and update new password
        user.password_hash = await bcrypt.hash(newPassword, saltRounds);
        await user.save();

        return res.status(200).json({ message: 'Password updated successfully' });

    } catch (err) {
        console.error('[Password update error]:', err);
        return res.status(500).json({ message: 'Server Error!' });
    }
});

app.patch('/api/user/dob', authTokenAPI, async (req, res) => {
    try {
        const { dob } = req.body;

        // Validate presence
        if (!dob) {
            return res.status(400).json({ message: 'Date of birth is required' });
        }

        // Validate date format
        const parsedDOB = new Date(dob);
        if (isNaN(parsedDOB.getTime())) {
            return res.status(400).json({ message: 'Invalid date format' });
        }

        // Validate user ID
        if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
            return res.status(400).json({ message: 'Invalid user ID' });
        }

        // Update user DOB
        const user = await User.findByIdAndUpdate(
            req.user.id,
            { dob: parsedDOB },
            { new: true }
        ).select('dob');

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        return res.status(200).json({
            message: 'Date of birth updated successfully',
            dob: user.dob,
        });

    } catch (err) {
        console.error('[DOB update error]:', err);
        return res.status(500).json({ message: 'Server error' });
    }
})

app.delete("/api/user", authTokenAPI, async (req, res) => {
    const session = await mongoose.startSession();

    try {
        const userId = new mongoose.Types.ObjectId(req.user.id);

        await session.withTransaction(async () => {

            // 1️⃣ Find user
            const user = await User.findById(userId).session(session);
            if (!user) {
                const err = new Error("User not found");
                err.statusCode = 404;
                throw err;
            }

            // 2️⃣ Soft delete user
            user.status = "deleted";
            user.username = `Cohortbox_User_${user._id.toString().slice(-5)}`;
            user.firstName = 'Cohortbox';
            user.lastName = 'User'
            user.dp = "https://media.cohortbox.com/user-dp/profile-user.png";
            user.chat_requests = [];
            user.friends = [];
            await user.save({ session });

            // 3️⃣ Delete notifications
            await Notification.deleteMany({ user: userId }).session(session);

            // 4️⃣ Delete friend requests
            await FriendRequest.deleteMany({
                $or: [{ from: userId }, { to: userId }]
            }).session(session);

            // 5️⃣ Handle chats where user is ADMIN
            const adminChats = await Chat.find({ chatAdmin: userId }).session(session);

            for (const chat of adminChats) {

                // Remove admin from participants list
                const remainingParticipants = chat.participants
                    .map(p => String(p))
                    .filter(p => p !== String(userId));

                if (remainingParticipants.length === 0) {
                    // No participants left → delete chat
                    await Chat.deleteOne({ _id: chat._id }).session(session);
                } else {
                    // Promote first remaining participant
                    chat.chatAdmin = remainingParticipants[0];
                    chat.participants = remainingParticipants;
                    await chat.save({ session });
                }
            }

            // 6️⃣ Remove user from chats where not admin
            await Chat.updateMany(
                { participants: userId },
                { $pull: { participants: userId } },
                { session }
            );

            await Chat.updateMany(
                { requested_participants: userId },
                { $pull: { requested_participants: userId } },
                { session }
            );

            await Chat.updateMany(
                { subscribers: userId },
                { $pull: { subscribers: userId } },
                { session }
            );

        });

        res.clearCookie("refreshToken", {
            httpOnly: true,
            sameSite: "lax",
            secure: false, // true in prod HTTPS
        });

        return res.status(200).json({
            message: "Account deleted successfully"
        });

    } catch (err) {
        console.error(err);
        return res.status(err.statusCode || 500).json({
            message: err.message || "Server Error"
        });
    } finally {
        session.endSession();
    }
});

app.post('/api/message', authTokenAPI, async (req, res) => {
    try {
        let { from, chatId, message, isReply, repliedTo, media, type, optimisticId } = req.body;
        console.log(req.body)
        from = new mongoose.Types.ObjectId(from);
        chatId = new mongoose.Types.ObjectId(chatId);
        if (!from || !chatId || (!message && (!media || media.length === 0) || (isReply && !repliedTo))) {
            return res.status(400).json({ message: 'Please send all required fields!' });
        }

        const chat = await Chat.findById(chatId).select('participants');
        if (!chat?.participants.some(p => p.equals(from))) {
            console.log('This user is not allowed to send messages');
            return res.status(403).json({ message: 'This user is not allowed to send messages' });
        }

        const newMessage = await Message.create({
            from,
            chatId,
            message,
            media,
            isReply,
            repliedTo,
            type: type || undefined,
            reactions: []
        });
        const populatedMessage = await Message.findById(newMessage._id)
            .populate('from', '_id firstName lastName username dp')
            .populate({
                path: 'repliedTo',
                select: 'from message media type',
                populate: { path: 'from', select: '_id username firstName lastName dp' }, // sender of repliedTo
            });
        return res.status(200).json({ message: populatedMessage, optimisticId });
    } catch (err) {
        console.log(err);
        return res.status(500).json({ message: 'Internal Server Error' })
    }
})

app.post("/api/chat", authTokenAPI, upload.single("image"), async (req, res) => {
  try {
    const io = req.app.get("io"); // socket.io instance
    const userId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user ID!" });
    }

    let {
      requested_participants = "[]",
      chatName,
      chatNiche = "",
    } = req.body;

    // Parse array
    try {
      requested_participants = JSON.parse(requested_participants);
      if (!Array.isArray(requested_participants)) requested_participants = [];
    } catch {
      return res.status(400).json({ message: "requested_participants must be a JSON array" });
    }

    if (!chatName || !chatName.trim()) {
      return res.status(400).json({ message: "chatName is required" });
    }

    // Enforce admin = logged in user (don't trust client)
    const chatAdmin = userId;

    const totalParticipants = requested_participants.length + 1;
    if (totalParticipants < 3) {
      return res.status(400).json({ message: "At least 3 participants are required to create a chat!" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "No image received" });
    }

    // 1) Create chat
    const newChat = new Chat({
      chatAdmin,
      chatName: chatName.trim(),
      chatNiche,
      chatDp: "",
      requested_participants,
      participants: [userId],
      status: "pending_requests",
    });

    await newChat.save();

    // 2) Upload DP to R2
    const ext =
      mime.extension(req.file.mimetype) ||
      path.extname(req.file.originalname || "").replace(".", "") ||
      "jpg";

    const key = `chat-dp/${newChat._id}/${crypto.randomUUID()}.${ext}`;

    const { url } = await uploadBufferToR2({
      key,
      buffer: req.file.buffer,
      contentType: req.file.mimetype,
      cacheControl: "public, max-age=31536000, immutable",
    });

    if (!url) {
      await Chat.findByIdAndDelete(newChat._id);
      return res.status(500).json({ message: "R2 upload failed / R2_PUBLIC_BASE not configured" });
    }

    newChat.chatDp = url;
    await newChat.save();

    // 3) Push chat requests to each requested participant
    for (const participantId of requested_participants) {
      await User.findByIdAndUpdate(participantId, {
        $push: { chat_requests: newChat._id },
      });
    }

    // Populate for response + for notification payload
    await newChat.populate("requested_participants", "_id firstName lastName username dp");

    // 4) Create notifications + emit socket events (MERGED PART)
    for (const participant of newChat.requested_participants) {
      if (String(participant._id) === String(newChat.chatAdmin)) continue;

      // Create notification in DB (match your schema fields)
      const notification = await Notification.create({
        user: participant._id,          // store ID (recommended)
        sender: newChat.chatAdmin,
        type: "added_to_group_request",
        chat: newChat._id,
        message: null,
        text: "",
      });

      // Emit to that specific user room (requires socket to join userId room)
      if (io) {
        io.to(String(participant._id)).emit("notification", notification);
      }
    }

    return res.status(200).json({ newChat, chatDpKey: key });
  } catch (err) {
    console.error("[start-chat] SERVER_ERROR", err);
    return res.status(500).json({ message: "Server Error!" });
  }
});

app.post("/api/upload-images", authTokenAPI, upload.array("media", 10), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: "No files uploaded" });
        }

        const uploads = await Promise.all(
            req.files.map(async (file) => {
                const isImage = file.mimetype?.startsWith("image/");
                const isVideo = file.mimetype?.startsWith("video/");

                if (!isImage && !isVideo) {
                    throw new Error(`Unsupported file type: ${file.mimetype}`);
                }

                const ext =
                    mime.extension(file.mimetype) ||
                    path.extname(file.originalname).replace(".", "") ||
                    (isImage ? "jpg" : "mp4");

                const folder = isImage ? "media/images" : "media/videos";
                const key = `${folder}/${crypto.randomUUID()}.${ext}`;

                const { url } = await uploadBufferToR2({
                    key,
                    buffer: file.buffer,
                    contentType: file.mimetype,
                    // Optional: different caching for videos
                    // cacheControl: isVideo ? "public, max-age=86400" : "public, max-age=31536000, immutable",
                });

                if (!url) throw new Error("R2_PUBLIC_BASE not configured");

                return {
                    url,
                    key,
                    type: isImage ? "image" : "video",
                    mimetype: file.mimetype,
                    size: file.size,
                };
            })
        );

        return res.status(200).json({ media: uploads });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Server Error!" });
    }
}
);

app.post("/api/upload-user-dp", authTokenAPI, upload.single('image'), async (req, res) => {
    try {
        console.log(req.file)
        if (!req.file) return res.status(400).json({ message: "No file uploaded" });

        const ext =
            mime.extension(req.file.mimetype) ||
            path.extname(req.file.originalname).replace(".", "") ||
            "jpg";

        const key = `user-dp/${crypto.randomUUID()}.${ext}`;

        const { url } = await uploadBufferToR2({
            key,
            buffer: req.file.buffer,
            contentType: req.file.mimetype,
            // cacheControl: "public, max-age=31536000, immutable", // optional override
        });

        if (!url) {
            // Happens if R2_PUBLIC_BASE is missing in env
            return res.status(500).json({ message: "R2_PUBLIC_BASE not configured" });
        }
        await User.findByIdAndUpdate(req.user.id, { dp: url });
        return res.status(200).json({ url, key });
    } catch (err) {
        console.error("R2 upload error:", err);
        return res.status(500).json({ message: "Upload failed" });
    }
});

app.post("/api/upload-chat-dp", authTokenAPI, upload.single("image"), async (req, res) => {
    try {
        const { chatId } = req.body;
        const userId = req.user.id;

        if (!chatId) return res.status(400).json({ message: "Please send chat ID!" });
        if (!mongoose.Types.ObjectId.isValid(chatId)) {
            return res.status(400).json({ message: "Please send a valid chat ID!" });
        }

        const chat = await Chat.findById(chatId).select("chatAdmin");
        if (!chat) return res.status(404).json({ message: "No Chat found" });

        if (String(chat.chatAdmin) !== String(userId)) {
            return res.status(403).json({ message: "User not Authorized!" });
        }

        if (!req.file) {
            return res.status(400).json({ message: "No image received" });
        }

        const ext =
            mime.extension(req.file.mimetype) ||
            path.extname(req.file.originalname || "").replace(".", "") ||
            "jpg";

        const key = `chat-dp/${chatId}/${crypto.randomUUID()}.${ext}`;

        const { url } = await uploadBufferToR2({
            key,
            buffer: req.file.buffer,
            contentType: req.file.mimetype,
            cacheControl: "public, max-age=31536000, immutable",
        });

        if (!url) return res.status(500).json({ message: "R2_PUBLIC_BASE not configured" });

        await Chat.findByIdAndUpdate(chatId, { chatDp: url });

        return res.status(200).json({ url, key });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Server Error!" });
    }
}
);

app.post("/api/upload-audio", authTokenAPI, uploadAudio.single("audio"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "No audio uploaded" });

        const ext =
            mime.extension(req.file.mimetype) ||
            path.extname(req.file.originalname || "").replace(".", "") ||
            "webm";

        const key = `audio/${crypto.randomUUID()}.${ext}`;

        const { url } = await uploadBufferToR2({
            key,
            buffer: req.file.buffer,
            contentType: req.file.mimetype,
            cacheControl: "public, max-age=31536000, immutable",
        });

        if (!url) return res.status(500).json({ message: "R2_PUBLIC_BASE not configured" });

        const media = {
            url,
            key,
            type: "audio",
            mimetype: req.file.mimetype,
            size: req.file.size,
        };

        return res.status(200).json({ media });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Server Error!" });
    }
});

app.post('/api/live-comment', authTokenAPI, async (req, res) => {
    try {
        const { chatId, message, repliedTo } = req.body;
        const from = new mongoose.Types.ObjectId(req.user.id);

        if (!mongoose.Types.ObjectId.isValid(chatId)) return res.status(400).json({ message: 'Invalid chatId' });
        if (!message || !message.trim()) return res.status(400).json({ message: 'Comment is required' })

        const payload = {
            from,
            message: message.trim(),
            createdAt: new Date(),
        }
        if (repliedTo && mongoose.Types.ObjectId.isValid(repliedTo)) {
            payload.repliedTo = repliedTo;
        }

        const result = await Chat.updateOne({ _id: chatId }, { $push: { liveComments: { $each: [payload], $slice: -500 } } })
        if (result.modifiedCount === 0) return res.status(400).json({ message: 'Comment could not be creaeted!' });

        const fromUser = await User.findById(from).select('_id username');

        if (fromUser) {
            payload.from = fromUser
        }

        return res.status(200).json({
            message: '',
            comment: payload
        })
    } catch (err) {
        console.log(err)
        return res.status(500).json({ message: 'Server Error!' })
    }
})

app.delete('/api/chat/:chatId', authTokenAPI, async (req, res) => {
    const { chatId } = req.params;

    try {
        // Validate ObjectId to prevent BSON errors
        if (!mongoose.Types.ObjectId.isValid(chatId)) {
            return res.status(400).json({ message: 'Invalid chatId!' });
        }

        // Delete chat
        await Chat.deleteOne({ _id: chatId });

        // Delete related notifications
        await Notification.deleteMany({ chat: chatId });

        return res.status(200).json({ message: 'Chat Deleted!' });

    } catch (err) {
        return res.status(500).json({ message: 'Internal Server Error!' });
    }
});

app.delete('/api/chat/participant/:userId/:chatId', authTokenAPI, async (req, res) => {
    const { chatId, userId } = req.params;

    try {
        if (!mongoose.Types.ObjectId.isValid(chatId)) {
            return res.status(400).json({ message: 'Invalid chatId!' });
        }
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ message: 'Invalid userId!' });
        }

        const updatedChat = await Chat.updateOne(
            { _id: chatId },
            { $pull: { participants: userId } }
        );

        if (updatedChat.modifiedCount === 0) {
            return res.status(404).json({ message: 'Participant not found or already removed!' });
        }

        return res.status(200).json({ message: 'Participant removed Successfully!' });

    } catch (err) {
        return res.status(500).json({ message: 'Internal Server Error!' });
    }
});

app.put('/api/chat/participant', authTokenAPI, async (req, res) => {
    try {
        const { participants, chatId } = req.body;

        if (
            !chatId ||
            !mongoose.Types.ObjectId.isValid(chatId) ||
            !Array.isArray(participants) ||
            participants.length === 0
        ) {
            return res.status(400).json({ message: 'Invalid payload!' });
        }

        // 1. Ensure chat exists
        const chat = await Chat.findById(chatId).select('_id chatAdmin requested_participants');
        if (!chat) {
            return res.status(404).json({ message: 'Chat not found!' });
        }

        if (String(chat.chatAdmin) !== String(req.user.id)) {
            return res.status(400).json({ message: "This user doesn't have permission to add participants." });
        }

        // 2. Add users to chat.requested_participants (no duplicates)
        await Chat.updateOne(
            { _id: chatId },
            { $addToSet: { requested_participants: { $each: participants } } }
        );

        // 3. Add chatId to each user's chat_requests (no duplicates)
        await User.updateMany(
            { _id: { $in: participants } },
            { $addToSet: { chat_requests: chatId } }
        );

        return res.status(200).json({
            message: 'Chat join requests sent successfully!'
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal Server Error!' });
    }
});

app.patch('/api/chat/subscribe', authTokenAPI, async (req, res) => {
    try {
        const { chatId } = req.body;
        const userId = req.user?.id;

        // Defensive checks
        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (!chatId) {
            return res.status(400).json({ message: 'Chat ID is required!' });
        }

        if (!mongoose.Types.ObjectId.isValid(chatId)) {
            return res.status(400).json({ message: 'Invalid Chat ID!' });
        }

        const updatedChat = await Chat.findByIdAndUpdate(
            chatId,
            { $addToSet: { subscribers: userId } }, // idempotent
            { new: true }
        ).select('subscribers');

        if (!updatedChat) {
            return res.status(404).json({ message: 'Chat not found!' });
        }

        return res.status(200).json({
            success: true,
            message: 'Subscribed',
            subscribers: updatedChat.subscribers,
        });

    } catch (err) {
        console.error('[SUBSCRIBE_CHAT_ERROR]', err);

        return res.status(500).json({
            success: false,
            message: 'Internal Server Error!',
        });
    }
});

app.patch('/api/chat/unsubscribe', authTokenAPI, async (req, res) => {
    try {
        const { chatId } = req.body;
        const userId = req.user?.id;

        // Defensive auth check
        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (!chatId) {
            return res.status(400).json({ message: 'Chat ID is required!' });
        }

        if (!mongoose.Types.ObjectId.isValid(chatId)) {
            return res.status(400).json({ message: 'Invalid Chat ID!' });
        }

        const updatedChat = await Chat.findByIdAndUpdate(
            chatId,
            { $pull: { subscribers: userId } }, // idempotent
            { new: true }
        ).select('subscribers');

        if (!updatedChat) {
            return res.status(404).json({ message: 'Chat not found!' });
        }

        return res.status(200).json({
            success: true,
            message: 'Unsubscribed',
            subscribers: updatedChat.subscribers,
        });

    } catch (err) {
        console.error('[UNSUBSCRIBE_CHAT_ERROR]', err);

        return res.status(500).json({
            success: false,
            message: 'Internal Server Error!',
        });
    }
});

app.post('/api/chat/accept/:chatId', authTokenAPI, async (req, res) => {
    try {
        const userId = req.user?.id;
        const { chatId } = req.params;

        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (!chatId) {
            return res.status(400).json({ message: 'Chat ID is required!' });
        }

        if (!mongoose.Types.ObjectId.isValid(chatId)) {
            return res.status(400).json({ message: 'Invalid Chat ID!' });
        }

        const chat = await Chat.findByIdAndUpdate(
            chatId,
            {
                $push: { participants: userId },
                $pull: { requsted_participants: userId },
            },
            { new: true }
        );

        if (!chat) {
            return res.status(400).json({ message: 'Chat not Found!' });
        }

        await User.findByIdAndUpdate(
            userId,
            { $pull: { chat_requests: chatId } }
        );

        let notification = await Notification.create({
            user: chat.chatAdmin,
            sender: userId,
            chat: chatId,
            type: 'accepted_group_request',
        });

        await Notification.deleteOne({
            user: userId,
            chat: chatId,
            type: 'added_to_group_request',
        });

        // Preserve your logic exactly
        if (chat.participants.length >= 3) {
            chat.status = 'active';
            await chat.save();
        }

        // ✅ Populate notification
        notification = await Notification.findById(notification._id)
            .populate('user', '_id username firstName lastName dp')
            .populate('sender', '_id username firstName lastName dp')
            .populate('chat', '_id chatName chatAdmin status');

        return res.status(200).json({
            success: true,
            chat,
            notification,
        });

    } catch (err) {
        console.error('[ACCEPT_CHAT_REQUEST_ERROR]', err);

        return res.status(500).json({
            success: false,
            message: 'Internal Server Error',
        });
    }
})

app.post('/api/chat/reject/:chatId', authTokenAPI, async (req, res) => {
    try {
        const userId = req.user?.id;
        const { chatId } = req.params;

        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (!chatId) {
            return res.status(400).json({ message: 'Chat ID is required!' });
        }

        if (!mongoose.Types.ObjectId.isValid(chatId)) {
            return res.status(400).json({ message: 'Invalid Chat ID!' });
        }

        // remove user from requested_participants
        const chat = await Chat.findByIdAndUpdate(
            chatId,
            { $pull: { requsted_participants: userId } },
            { new: true }
        );

        if (!chat) {
            return res.status(400).json({ message: 'Chat not Found!' });
        }

        // remove chat from user's chat_requests
        await User.findByIdAndUpdate(
            userId,
            { $pull: { chat_requests: chatId } }
        );

        // delete related notification
        await Notification.deleteOne({
            user: userId,
            chat: chatId,
            type: 'added_to_group_request',
        });

        return res.status(200).json({
            success: true,
            chat,
        });

    } catch (err) {
        console.error('[REJECT_CHAT_REQUEST_ERROR]', err);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
})

app.post('/api/friends/request/:userId', authTokenAPI, async (req, res) => {
    try {
        const fromUserId = req.user?.id;
        const toUserId = req.params.userId;

        if (!fromUserId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (!toUserId) {
            return res.status(400).json({ message: 'Target user ID is required' });
        }

        if (!mongoose.Types.ObjectId.isValid(toUserId)) {
            return res.status(400).json({ message: 'Invalid target user ID' });
        }

        // create friend request
        const request = await FriendRequest.create({
            from: fromUserId,
            to: toUserId,
        });

        // populate request
        const populatedRequest = await FriendRequest.findById(request._id)
            .populate('from', '_id firstName lastName')
            .populate('to', '_id firstName lastName')
            .lean();

        // create notification
        const notification = await Notification.create({
            user: toUserId,
            type: 'friend_request_received',
            sender: fromUserId,
        });

        // populate notification
        const populatedNotification = await Notification.findById(notification._id)
            .populate('sender', '_id firstName lastName dp')
            .lean();

        return res.status(201).json({
            success: true,
            request: populatedRequest,
            notification: populatedNotification,
        });

    } catch (err) {
        console.error('[FRIEND_REQUEST_ERROR]', err);
        return res.status(500).json({
            message: 'Failed to send friend request',
        });
    }
});

app.delete('/api/friends/request/:userId', authTokenAPI, async (req, res) => {
    try {
        const fromUserId = req.user?.id;
        const toUserId = req.params.userId;

        if (!fromUserId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (!toUserId) {
            return res.status(400).json({ message: 'Target user ID is required' });
        }

        if (!mongoose.Types.ObjectId.isValid(toUserId)) {
            return res.status(400).json({ message: 'Invalid target user ID' });
        }

        const deleted = await FriendRequest.findOneAndDelete({
            from: fromUserId,
            to: toUserId,
        })
            .populate('from', '_id firstName lastName')
            .populate('to', '_id firstName lastName')
            .lean();

        // keep logic: notification deletion regardless of request existence
        await Notification.deleteOne({
            user: toUserId,
            sender: fromUserId,
            type: 'friend_request_received',
        });

        return res.status(200).json({
            success: true,
            request: deleted,
        });

    } catch (err) {
        console.error('[CANCEL_FRIEND_REQUEST_ERROR]', err);
        return res.status(500).json({
            message: 'Failed to cancel friend request',
        });
    }
});

app.post('/api/friends/accept/:userId', authTokenAPI, async (req, res) => {
    try {
        const fromUserId = req.params.userId;
        const toUserId = req.user?.id;

        if (!toUserId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (!fromUserId) {
            return res.status(400).json({ message: 'Sender user ID is required' });
        }

        if (!mongoose.Types.ObjectId.isValid(fromUserId)) {
            return res.status(400).json({ message: 'Invalid sender user ID' });
        }

        const from = await User.findById(fromUserId);
        const to = await User.findById(toUserId);

        if (!from || !to) {
            return res.status(404).json({ message: 'User not found' });
        }

        // SAME logic
        if (!from.friends.includes(toUserId)) from.friends.push(toUserId);
        if (!to.friends.includes(fromUserId)) to.friends.push(fromUserId);

        await Promise.all([from.save(), to.save()]);

        await FriendRequest.deleteOne({
            from: fromUserId,
            to: toUserId,
        });

        await Notification.deleteOne({
            user: toUserId,
            sender: fromUserId,
            type: 'friend_request_received',
        });

        const notification = await Notification.create({
            user: fromUserId,
            type: 'friend_request_accepted',
            sender: toUserId,
        });

        const populatedNotification = await Notification.findById(notification._id)
            .populate('sender', '_id username firstName lastName dp')
            .lean();

        return res.status(200).json({
            success: true,
            from: fromUserId,
            to: toUserId,
            notification: populatedNotification,
        });

    } catch (err) {
        console.error('[ACCEPT_FRIEND_REQUEST_ERROR]', err);
        return res.status(500).json({
            message: 'Failed to accept friend request',
        });
    }
});

app.post('/api/friends/reject/:userId', authTokenAPI, async (req, res) => {
    try {
        const fromUserId = req.params.userId;
        const toUserId = req.user?.id;

        if (!toUserId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (!fromUserId) {
            return res.status(400).json({ message: 'Sender user ID is required' });
        }

        if (!mongoose.Types.ObjectId.isValid(fromUserId)) {
            return res.status(400).json({ message: 'Invalid sender user ID' });
        }

        const fr = await FriendRequest.findOne({
            from: fromUserId,
            to: toUserId,
        });

        if (!fr) {
            return res.status(404).json({ message: 'Friend request not found' });
        }

        // SAME logic
        await FriendRequest.deleteOne({
            from: fromUserId,
            to: toUserId,
        });

        await Notification.deleteOne({
            user: toUserId,
            sender: fromUserId,
            type: 'friend_request_received',
        });

        return res.status(200).json({
            success: true,
            from: fromUserId,
            to: toUserId,
        });

    } catch (err) {
        console.error('[REJECT_FRIEND_REQUEST_ERROR]', err);
        return res.status(500).json({
            message: 'Failed to reject friend request',
        });
    }
});

app.delete('/api/friends/:userId', authTokenAPI, async (req, res) => {
    try {
        const userId = req.user?.id;
        const friendId = req.params.userId;

        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (!friendId) {
            return res.status(400).json({ message: 'Friend ID is required' });
        }

        if (!mongoose.Types.ObjectId.isValid(friendId)) {
            return res.status(400).json({ message: 'Invalid friend ID' });
        }

        // SAME LOGIC — mutual removal
        await User.findByIdAndUpdate(userId, {
            $pull: { friends: friendId },
        });

        await User.findByIdAndUpdate(friendId, {
            $pull: { friends: userId },
        });

        const removedFriend = await User.findById(friendId)
            .select('_id firstName lastName')
            .lean();

        if (!removedFriend) {
            return res.status(404).json({ message: 'Friend not found' });
        }

        return res.status(200).json({ removedFriend });

    } catch (err) {
        console.error('[UNFRIEND_ERROR]', err);
        return res.status(500).json({
            message: 'Failed to unfriend user',
        });
    }
});

app.post('/api/notification', authTokenAPI, async (req, res) => {
    try {
        const { user, sender, type, chat, message, text } = req.body;

        // Basic validation
        if (!user || !sender || !type) {
            return res.status(400).json({ message: 'Missing required notification fields!' });
        }

        // Create the notification
        const newNotification = await Notification.create({
            user,
            sender,
            type,
            chat,
            message,
            text
        });

        // Populate references
        const populatedNotification = await Notification.findById(newNotification._id)
            .populate('sender', '_id firstName lastName username dp')
            .populate('chat', '_id chatAdmin chatName chatDp')
            .populate('message', '_id message type')
            .lean(); // optional: return plain JS object

        console.log(populatedNotification);
        return res.status(200).json({ notification: populatedNotification });

    } catch (err) {
        console.error('[POST /api/notification] SERVER_ERROR', err);
        return res.status(500).json({
            error: 'Failed to create notification',
            details: err.message
        });
    }
});

app.get('/api/media/:chatId', authTokenAPI, async (req, res) => {
    try {
        const { chatId } = req.params;
        const { lastId, limit = 30, mediaType } = req.query;

        if (!mongoose.Types.ObjectId.isValid(chatId)) {
            return res.status(400).json({ message: "Invalid chatId" });
        }

        const safeLimit = Math.min(Number(limit) || 30, 200);

        const filter = {
            chatId: new mongoose.Types.ObjectId(chatId),
            type: "media",
            media: { $exists: true, $ne: [] }, // ensure there is media
        };

        // Cursor pagination
        if (lastId) {
            if (!mongoose.Types.ObjectId.isValid(lastId)) {
                return res.status(400).json({ message: "Invalid lastId" });
            }
            filter._id = { $lt: new mongoose.Types.ObjectId(lastId) };
        }

        // Optional filter: only messages containing a certain media subtype
        if (mediaType && ["image", "video", "audio"].includes(mediaType)) {
            filter["media.type"] = mediaType;
        }

        const mediaMessages = await Message.find(filter)
            .populate('from', '_id firstName lastName dp')
            .sort({ _id: -1 })
            .limit(safeLimit)
            .lean();

        if (mediaMessages.length === 0) {
            return res.status(404).json({ message: "No media found for this chat!" });
        }

        const result = await Message.aggregate([
            {
                $match: {
                    chatId: new mongoose.Types.ObjectId(chatId),
                },
            },

            // explode media array
            { $unwind: "$media" },

            // keep only image + video
            {
                $match: {
                    "media.type": { $in: ["image", "video"] },
                },
            },

            {
                $count: "totalMedia",
            },
        ]);

        const total = result.length > 0 ? result[0].totalMedia : 0;

        return res.status(200).json({ media: mediaMessages, total });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Server error", details: err.message });
    }
});

app.post('/api/report', authTokenAPI, async (req, res) => {
    try {
        const { target, targetModel, reason, description } = req.body;
        const from = req.user.id; // comes from authMiddleware

        // Validate
        if (!target || !targetModel || !reason) {
            return res.status(400).json({ message: "target, targetModel, and reason are required" });
        }

        // Create new report
        const report = await Report.create({
            from,
            target,
            targetModel,
            reason,
            description: description?.trim() || undefined,
        });

        return res.status(201).json({ report, success: true });
    } catch (err) {
        console.error("Report API error:", err);
        return res.status(500).json({ message: "Internal Server Error" });
    }
});

app.post('/api/reaction', authTokenAPI, async (req, res) => {
    try {
        const { msgId, chatId, emoji, remove } = req.body;

        // ✅ validate
        if (!msgId || !mongoose.Types.ObjectId.isValid(msgId)) {
            return res.status(400).json({ message: "Invalid msgId" });
        }
        if (!chatId || !mongoose.Types.ObjectId.isValid(chatId)) {
            return res.status(400).json({ message: "Invalid chatId" });
        }
        if (!emoji || typeof emoji !== "string") {
            return res.status(400).json({ message: "Invalid emoji" });
        }

        // ✅ always take userId from token (never trust client body)
        const userId = req.user?.id;
        if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const userObjectId = new mongoose.Types.ObjectId(userId);

        const user = await User.findById(userObjectId).select('_id username');
        if (!user) {
            return res.status(404).json({ message: "No User Found" });
        }

        const chatObjectId = new mongoose.Types.ObjectId(chatId);

        // ✅ update reactions exactly like your socket code
        const result = await Message.updateOne(
            { _id: msgId, chatId: chatObjectId },
            [
                {
                    $set: {
                        reactions: {
                            $cond: [
                                !!remove,
                                {
                                    $filter: {
                                        input: { $ifNull: ["$reactions", []] },
                                        as: "r",
                                        cond: { $ne: ["$$r.userId", userObjectId] }
                                    }
                                },
                                {
                                    $concatArrays: [
                                        {
                                            $filter: {
                                                input: { $ifNull: ["$reactions", []] },
                                                as: "r",
                                                cond: { $ne: ["$$r.userId", userObjectId] }
                                            }
                                        },
                                        [{ userId: userObjectId, emoji }]
                                    ]
                                }
                            ]
                        }
                    }
                }
            ]
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ message: "Message not found for this chat" });
        }

        // ✅ return what client needs to update UI + emit socket itself
        const updated = await Message.findById(msgId)
            .select("_id chatId reactions")
            .lean();

        return res.status(200).json({
            success: true,
            reaction: {
                msgId,
                chatId,
                userId,
                username: user.username,
                emoji,
                remove: !!remove,
                reactions: updated?.reactions || []
            }
        });

    } catch (err) {
        console.log(err);
        return res.status(500).json({ message: 'Internal Server Error!' })
    }
});

io.on('connection', (socket) => {
    console.log("A user connected:", socket.user);

    socket.on('register', async (userID) => {
        try {
            if (!userID) return;
            const userDB = await User.findById(userID).select('firstName lastName');
            if (!userDB) return;
            onlineUsers[userID] = {
                socketID: socket.id,
                username: `${userDB.firstName} ${userDB.lastName}`
            };
            console.log(userID, "is online with socket", socket.id);


        } catch (err) {
            console.log(err);
            return;
        }
    });

    socket.on('joinChat', async ({ chatId, role }) => {
        try {
            const userId = socket.user.id;

            if (!mongoose.Types.ObjectId.isValid(chatId)) return;

            const chatIdStr = String(chatId);

            if (role === "viewer") {
                socket.join(`chat:${chatIdStr}:viewers`);
                trackViewer(chatId, userId);
                emitViewerCount(chatId);
                socket.currentChatId = chatId;
                socket.currentRole = "viewer";
                return;
            }

            // participant
            const participants = await getParticipants(chatId);
            if (!participants?.has(String(userId))) return;

            socket.join(`chat:${chatIdStr}:members`);
            socket.currentChatId = chatId;
            socket.currentRole = "member";
        } catch (err) {
            console.log(err);
            return;
        }
    });

    socket.on('leaveChat', (chatId) => {
        try {
            const userId = socket.user.id;
            if (!chatId) return;

            socket.leave(`chat:${chatId}:viewers`);
            socket.leave(`chat:${chatId}:members`);

            untrackViewer(chatId, userId);
            emitViewerCount(chatId);
        } catch (err) {
            console.log(err);
            return;
        }
    });

    socket.on('participantRemoved', async ({ userId, chatId }) => {
        try {
            console.log('Received particpantRemoved');
            if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(chatId)) return;
            const removedUser = await User.findById(userId);
            if (!removedUser) return;
            const chat = await Chat.findById(chatId).select('chatAdmin');
            if (!chat) return;
            if (String(socket.user.id) !== String(chat.chatAdmin)) return;
            const newMessage = await Message.create({
                from: chat.chatAdmin,
                chatId,
                message: `Admin Removed ${removedUser.username}`,
                type: 'chatInfo',
                media: [],
                reactions: []
            });
            io.to(chatId).emit('participantRemoved', { userId, chatId, msg: newMessage });
        } catch (err) {
            console.log(err);
            return;
        }
    });

    socket.on('participantRequested', async ({ userId, chatId, message }) => {
        try {
            console.log('Received particpantAdded');
            if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(chatId)) return;
            const chat = await Chat.findById(chatId).select('chatAdmin');
            if (String(socket.user.id) !== String(chat.chatAdmin)) return;
            const addedUser = await User.findById(userId).select('_id firstName lastName username dp').lean();
            if (!addedUser) return
            io.to(chatId).emit('participantRequested', { chatId, msg: message });
        } catch (err) {
            console.log(err);
            return;
        }
    });

    socket.on('participantAccepted', async ({ chatId }) => {
        try {
            console.log('Received participantAccepted');
            const userId = socket.user.id;
            if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(chatId)) return;
            const chat = await Chat.findOne({ _id: chatId, participants: userId });
            if (!chat) return;
            const user = await User.findById(userId).select('_id username firstName lastName dp');
            if (!user) return;
            console.log('Hogya participantAccepted');
            io.to(chatId).emit('participantAccepted', { chatId, user });
        } catch (err) {
            console.log(err);
            return;
        }
    })

    socket.on('participantJoined', async ({ chatId }) => {
        try {
            const userId = socket.user.id;
            if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(chatId)) return;
            const chat = await Chat.findOne({ _id: chatId, participants: userId });
            if (!chat) return;
            const user = await User.findById(userId).select('_id username firstName lastName dp').lean();
            if (!user) return
            io.to(chatId).emit('participantJoined', { user, chatId });
        } catch (err) {
            console.log(err);
            return;
        }
    });

    socket.on('participantLeft', ({ userId, chatId }) => {

    })

    socket.on('message', async ({ message }) => {
        try {
            if (String(socket.user.id) !== String(message.from._id)) {
                return;
            }
            if (!message) {
                console.log('Rejected: no message');
                return;
            }

            if (
                !message.type ||
                (message.type === 'text' && !message.message?.trim()) ||
                (message.type === 'media' && (!Array.isArray(message.media) || message.media.length === 0)) ||
                (message.type === 'audio' && (!Array.isArray(message.media) || message.media.length === 0))
            ) {
                return;
            }

            if (
                !mongoose.Types.ObjectId.isValid(message.from._id) ||
                !mongoose.Types.ObjectId.isValid(message.chatId)
            ) {
                return;
            }

            const userObjectId = new mongoose.Types.ObjectId(socket.user.id);
            const chatId = new mongoose.Types.ObjectId(message.chatId);
            const chatIdStr = String(message.chatId);
            const participants = await getParticipants(chatId);
            if (!participants || !participants.has(String(userObjectId))) return;

            queueMessage(chatIdStr, message);
            emitToChatParticipant(chatId, 'message', message)

        } catch (err) {
            console.error("Message socket error:", err);
            return;
        }
    });

    socket.on('privateMessageRead', async ({ msgId, to, chatId }) => {
        try {
            const receiverSocket = onlineUsers[to];
            await Message.updateOne({ _id: msgId }, { $set: { read: true } })
            if (receiverSocket) {
                io.to(receiverSocket.socketID).emit('messagesRead', ({ chatId, reader: socket.user.id }))
            }
        } catch (err) {
            console.log(err);
        }
    });

    socket.on('reaction', async (data) => {
        try {
            const { msgId, chatId, username, emoji, remove, reactions } = data;

            // basic validation
            if (!mongoose.Types.ObjectId.isValid(msgId)) return;
            if (!mongoose.Types.ObjectId.isValid(chatId)) return;
            if (!emoji || typeof emoji !== "string") return;

            // ✅ enforce userId from token, not client
            const userId = socket.user.id;

            // ✅ broadcast to everyone in that chat (members + viewers)
            emitToChat(chatId, 'reaction', {
                msgId,
                chatId,
                userId,
                username,
                emoji,
                remove: !!remove,
                reactions // optional (if you send it from API response)
            });

        } catch (err) {
            console.log(err);
        }
    });

    socket.on('typing', async (data) => {
        try {
            console.log('typing')
            const { chatId, typing } = data;
            const fromId = socket.user.id;
            const chat = await Chat.findById(chatId);
            if (!chat) return;
            if (!chat.participants.some(p => String(p) === String(fromId))) return;
            const username = onlineUsers[fromId]?.username || `${socket.user.firstName || ''} ${socket.user.lastName || ''}`.trim();

            const payload = {
                chatId,
                userId: fromId,
                username,
                typing: !!typing
            }
            io.to(`chat:${String(chatId)}:members`).emit('typing', payload);
        } catch (err) {
            console.log('typing error:', err);
            return;
        }
    });

    socket.on('liveComment', async (data) => {
        try {
            if (!data) {
                return;
            }

            const { chatId, comment } = data;

            if (!chatId) {
                return;
            }

            if (typeof comment.message !== 'string' || !comment.message.trim()) {
                return;
            }

            if (!mongoose.Types.ObjectId.isValid(chatId)) {
                return;
            }
            emitToChat(chatId, 'liveComment', data);
        } catch (err) {
            console.error('[liveComment] SOCKET_ERROR', err);
            return;
        }
    });

    socket.on('liveCommentPin', async ({ chatId, comment }) => {
        try {
            if (!chatId || !comment) return;

            const chat = await Chat.findById(chatId).select('participants');
            if (!chat) return;

            const isParticipant = chat.participants.some(
                p => p.toString() === socket.user.id
            );

            if (!isParticipant) {
                console.warn(`Unauthorized pin attempt by ${socket.user.id}`);
                return;
            }

            emitToChat(chatId, 'liveCommentPin', { chatId, comment });

        } catch (err) {
            console.error(err);
            return;
        }
    });

    socket.on('friendRequest', async (request) => {
        try {
            socket.emit('friendRequestSent', request);
            const receiverSocket = onlineUsers[request.to._id];
            if (receiverSocket) {
                io.to(receiverSocket.socketID).emit('friendRequestReceived', request);
            }
        } catch (err) {
            console.log(err);
            return;
        }
    });

    socket.on('cancelFriendRequest', async (request) => {
        try {
            socket.emit('friendRequestCanceled', { to: request.to._id, from: request.from._id });
            const receiverSocket = onlineUsers[request.to._id];
            console.log(receiverSocket);
            if (receiverSocket) {
                io.to(receiverSocket.socketID).emit('friendRequestCanceled', {
                    from: socket.user.id,
                    to: request.to._id
                });
            }
        } catch (err) {
            console.log(err);
            return;
        }
    });

    socket.on('acceptFriendRequest', async (userId) => {
        try {
            const fromUserId = userId;
            const fromUser = await User.findById(fromUserId).select('_id firstName lastName');
            const fromFriendObj = {
                _id: fromUser._id,
                firstName: fromUser.firstName,
                lastName: fromUser.lastName
            };
            const toUserId = socket.user.id;
            socket.emit('friendRequestAccepted', { to: toUserId, from: fromUserId, friendObj: fromFriendObj });
            const toUser = await User.findById(toUserId).select('_id firstName lastName');
            const toFriendObj = {
                _id: toUser._id,
                firstName: toUser.firstName,
                lastName: toUser.lastName
            };
            const receiverSocket = onlineUsers[userId];
            if (receiverSocket) {
                io.to(receiverSocket.socketID).emit('friendRequestAccepted', {
                    from: fromUserId,
                    to: toUserId,
                    friendObj: toFriendObj
                });
            }
        } catch (err) {
            console.log(err);
            return;
        }
    });

    socket.on('rejectFriendRequest', async (data) => {
        try {
            socket.emit('friendRequestRejected', { to: data.to, from: data.from });
            const receiverSocket = onlineUsers[data.from];
            if (receiverSocket) {
                io.to(receiverSocket.socketID).emit('friendRequestRejected', { to: data.to, from: data.from });
            }
        } catch (err) {
            console.log(err);
            return;
        }
    });

    socket.on('unfriend', async (userId) => {
        try {
            socket.emit('unfriend', userId);
            const receiverSocket = onlineUsers[userId];
            if (receiverSocket) {
                io.to(receiverSocket.socketID).emit('unfriend', socket.user.id);
            }
        } catch (err) {
            console.log(err);
            return;
        }
    });

    socket.on('notification', async (notification) => {
        try {
            const receiverSocket = onlineUsers[notification.user];
            if (receiverSocket) {
                io.to(receiverSocket.socketID).emit('notification', notification)
            }
        } catch (err) {
            console.error(err);
            return;
        }
    });

    socket.on('deleteMessage', async (msg) => {
        try {
            if (!msg) {
                return;
            }

            const messageId = msg._id;
            const chatId = msg.chatId;

            if (
                !mongoose.Types.ObjectId.isValid(messageId) ||
                !mongoose.Types.ObjectId.isValid(chatId)
            ) {
                return;
            }

            const userId = socket.user.id;
            const userObjectId = new mongoose.Types.ObjectId(userId);
            const chatObjectId = new mongoose.Types.ObjectId(chatId);

            const chat = await Chat.findById(chatObjectId).select('participants');
            if (!chat) {
                return;
            }

            if (!chat.participants.some(p => p.equals(userObjectId))) {
                return;
            }

            const message = await Message.findOne({ _id: messageId, from: socket.user.id, chatId });

            if (!message) return;

            emitToChat(chatId, 'deleteMessage', msg);

        } catch (err) {
            console.error('[deleteMessage] SOCKET_ERROR', err);
            return;
        }
    });

    socket.on('disconnect', () => {
        let disconnectedUserId = null;

        for (let userID in onlineUsers) {
            if (onlineUsers[userID].socketID === socket.id) {
                disconnectedUserId = userID;
                delete onlineUsers[userID];
                break;
            }
        }

        const chatId = socket.currentChatId;   // ✅ FIX
        if (chatId && disconnectedUserId) {
            untrackViewer(chatId, disconnectedUserId); // ✅ reuse your function
            emitViewerCount(chatId);
        }

        console.log('Socket disconnected:', socket.id);
    });

});

connectDB(process.env.MONGO_URI)
    .then(() => {
        console.log("✅ MongoDB connected");
        const PORT = process.env.SERVER_PORT || 5000;
        server.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
    })
    .catch(err => {
        console.error("❌ DB connection failed:", err);
        process.exit(1); // stop the app
    });
