import './MediaMessagePreview.css';
import { useEffect, useMemo, useState } from 'react';
import closeImg from '../images/close-gray.png';
import sendImg from '../images/send.png'
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { useNavigate } from 'react-router-dom';

function MediaMessage({ files, setFiles, selectedChat, setMessages, isReply, repliedTo, setIsReply, setRepliedTo }){
    const { socket } = useSocket();
    const filesArr = Array.from(files);
    const [message, setMessage] = useState('');
    const [index, setIndex] = useState(0);
    const { user, accessToken } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        function handleKeydown(e){
            if(e.key === 'ArrowRight'){
                setIndex(prev => Math.min(prev + 1, filesArr.length - 1));
            }else if(e.key === 'ArrowLeft'){
                setIndex(prev => Math.max(prev - 1, 0));
            }
        }
        document.addEventListener('keydown', handleKeydown)

        return () => {
            document.removeEventListener('keydown', handleKeydown)
        }
    }, [])

    function handleClose() {
        setFiles([]); // clear selected files
        setIndex(0);
    }

    function sendMessage(e) {
        e.preventDefault();

        if (!socket || !selectedChat) return;
        if (!message.trim() && files.length === 0) return;

        // create optimistic message immediately
        const optimisticId = Date.now();

        const optimisticMessage = {
            from: {
                _id: user.id,
                username: user.username,
                firstName: user.firstName,
                lastName: user.lastName,
            },
            chatId: selectedChat._id,
            type: "media",
            isReply: isReply ? true : false,
            repliedTo: (isReply && repliedTo) ? repliedTo : null,
            reactions: [],
            media: files.map(f => ({
                url: URL.createObjectURL(f),
                type: f.type.startsWith("image/")
                    ? "image"
                    : f.type.startsWith("video/")
                        ? "video"
                        : "audio",
            })),
            message: message.trim() ? message.trim() : " ",
            _id: optimisticId,
            pending: true,
            timestamp: Date.now(),
        };

        setMessages(prev => [optimisticMessage, ...prev]);

        // body you send to backend later
        const newMessageBodyBase = {
            optimisticId,
            from: user.id,
            chatId: selectedChat._id,
            type: "media",
            isReply: isReply ? true : false,
            repliedTo: isReply ? repliedTo?._id : null,
            reactions: [],
            message: message.trim() ? message.trim() : " ",
            media: [],
        };

        // clear UI inputs right away (like your text version)
        setIsReply(false);
        setRepliedTo(null);
        setMessage("");
        setIndex(0);
        setFiles([]);

        // 1) upload images
        const formData = new FormData();
        for (const file of files) {
            formData.append("media", file);
        }

        fetch(`/api/upload-images`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${accessToken}`,
            },
            body: formData,
        })
            .then(response => {
                if (!response.ok) throw new Error("Upload failed");
                return response.json();
            })
            .then(data => {
                const media = data.media;

                // 2) create message with uploaded media URLs/ids
                const newMessageBody = {
                    ...newMessageBodyBase,
                    media,
                };

                return fetch("/api/message", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        authorization: `Bearer ${accessToken}`,
                    },
                    body: JSON.stringify(newMessageBody),
                });
            })
            .then(res => {
                if (!res.ok) throw new Error("Message create failed");
                return res.json();
            })
            .then(data => {
                if (data.message) {
                    // replace optimistic message with real one
                    setMessages(prev =>
                        prev.map(m =>
                            String(m._id) === String(data.optimisticId)
                                ? { ...data.message, _id: data.message._id }
                                : m
                        )
                    );

                    socket.emit("message", { message: data.message });
                }
            })
            .catch(err => {
                console.error(err);
                // optional: mark optimistic message as failed instead of hard-crash
                // setMessages(prev => prev.map(m => String(m._id) === String(optimisticId) ? { ...m, pending: false, failed: true } : m));
                navigate("/crash");
            });
    }

    // ---------- Media Message = mmsg ---------- 
    return (
        <div className='mmsg-container'>
            <div className='mmsg-close-btn-container'>
                <button className='mmsg-close-btn'><img src={closeImg} className='mmsg-close-img' onClick={handleClose}/></button>
            </div>
            <div className='mmsg-main-media-container'>
                {
                    files[index].type.startsWith('image/') ? (
                        <img src={URL.createObjectURL(files[index])} className='mmsg-main-media'/>
                    ) : (
                        <video src={URL.createObjectURL(files[index])} className='mmsg-main-media' controls/>
                    )
                }
            </div>
            <div className='mmsg-preview-container'>
                {
                    filesArr.map((file, index) => {
                        return file.type.startsWith('image/') ? (
                            <img key={index} src={URL.createObjectURL(file)} className='mmsg-preview' onClick={() => setIndex(index)}/>
                        ) : (
                            <video key={index} src={URL.createObjectURL(file)} className='mmsg-preview' onClick={() => setIndex(index)}/>
                        )
                    })
                }
            </div>
            <form className='msg-input-form' onSubmit={sendMessage}>
                <input
                type="text"
                value={message}
                placeholder="Type a caption"
                onChange={(e) => setMessage(e.target.value)}
                className='msg-input'
                />
                <button className='msg-send-btn' onClick={(e) => sendMessage(e)}><img className='msg-send-img' src={sendImg}/></button>
            </form>
        </div>
    )
}

export default MediaMessage