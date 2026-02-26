import { useState, useCallback, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import NavBar from './components/NavBar'
import SearchBar from './components/SearchBar';
import './NewCohortBox.css';
import { useAuth } from './context/AuthContext';
import Toast from './components/Toast';
import { useSocket } from './context/SocketContext';
import { Navigate, useNavigate } from 'react-router-dom';
import LoadingScreen from './components/LoadingScreen';

function NewCohortBox(){
    const [searchBarClass, setSearchBarClass] = useState(' hidden');
    const [members, setMembers] = useState([]);
    const [chatName, setChatName] = useState('');
    const [chatNiche, setChatNiche] = useState('');
    const { user, accessToken, loading } = useAuth();
    const [preview, setPreview] = useState(null);
    const [dpFile, setDpFile] = useState(null);
    const [toastMsg, setToastMsg] = useState('');
    const [showToast, setShowToast] = useState(false);
    const [initialLoad, setInitialLoad] = useState(true);
    const { socket } = useSocket();
    const [chatNameAvailable, setChatNameAvailable] = useState(null); // null | true | false
    const navigate = useNavigate();


    useEffect(() => {
        if (!accessToken && !loading) {
            navigate('/login');
        }
    }, [accessToken]);

    useEffect(() => {
        setTimeout(() => {
            setInitialLoad(false);
        }, 750)
    }, [setInitialLoad]);

    const chatNameDebounceRef = useRef(null);

    function chatNameCheck(value) {
        const name = (value ?? chatName).trim();

        // Clear previous timer
        if (chatNameDebounceRef.current) {
            clearTimeout(chatNameDebounceRef.current);
        }

        // If empty, reset state
        if (!name) {
            setChatNameAvailable(null);
            return;
        }

        const chatNameInput = document.getElementById('chatName');

        chatNameDebounceRef.current = setTimeout(async () => {
            try {
                const res = await fetch(
                    `/api/check-chatname?chatname=${encodeURIComponent(name)}`,
                    {
                        method: "GET",
                        headers: { authorization: `Bearer ${accessToken}` },
                    }
                );

                const data = await res.json().catch(() => null);

                // If server gives 400 for invalid
                if (!res.ok) {
                    chatNameInput.style.borderColor = 'red';
                    setChatNameAvailable(false);
                    return;
                }

                setChatNameAvailable(Boolean(data?.available));

                if (data?.available === false) {
                    chatNameInput.style.borderColor = 'red'
                } else {
                    chatNameInput.style.borderColor = '#1ff200'
                }

            } catch (err) {
                console.error(err);
                setChatNameAvailable(false);
            }
        }, 500); // ✅ debounce delay
    }

    function showAlert(msg) {
        setToastMsg(msg);
        setShowToast(true);
    }

    const MAX_SIZE = 2 * 1024 * 1024; // 2MB

    const onDrop = useCallback((acceptedFiles) => {
        const file = acceptedFiles[0];
        if (file) {
            setPreview(URL.createObjectURL(file));
            setDpFile(file);
        }
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: { "image/*": [] },
        maxFiles: 1,
        maxSize: MAX_SIZE,
        onDropRejected: (rejections) => {
            rejections.forEach((rej) => {
                if (rej.errors[0].code === "file-too-large") {
                    showAlert("Your image is larger than 2MB. Pick a smaller file.");
                } else {
                    showAlert("Invalid file selected.");
                }
            });
        }
    });

    async function handleCreate(e) {
        e.preventDefault();

        if (!chatNameAvailable) {
            showAlert("Please choose a different Cohort Box name.");
            return;
        }

        if (!chatName.trim()) {
            showAlert("Please enter a name for the Cohort Box.");
            return;
        }

        if (!dpFile) {
            showAlert("Please select a chat display picture.");
            return;
        }

        const requested_participants = members.map((m) => m._id);

        // ✅ Send everything in ONE request (multipart/form-data)
        const formData = new FormData();
        formData.append("image", dpFile);
        formData.append("chatName", chatName);
        formData.append("chatNiche", chatNiche || "");
        formData.append("requested_participants", JSON.stringify(requested_participants));

        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: {
                    authorization: `Bearer ${accessToken}`,
                    // ❗ don't set Content-Type manually for FormData
                },
                body: formData,
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                showAlert(err.message || "Start chat request failed");
                return;
            }

            const { newChat } = await response.json();

            // ✅ Notifications are now created + emitted by backend
            navigate(`/${newChat._id}`);
        } catch (err) {
            console.error(err);
            showAlert("Something went wrong while creating the chat.");
        }
    }
    // ---------- new-cohort-box === ncb ----------

    return (
        <>
            {
                initialLoad ?
                    <LoadingScreen /> :

                    <div className='ncb-container'>
                        <title>Create New CohortBox | CohortBox</title>
                        <NavBar />
                        <div className='ncb-body-container'>
                            <h4 className='ncb-heading'>START A NEW COHORT BOX</h4>
                            <div className='ncb-options-container'>
                                <div className='ncb-select-members'>
                                    <SearchBar searchBarClass={searchBarClass} setSearchBarClass={setSearchBarClass} members={members} setMembers={setMembers} chatId={null} addParticipant={false} />
                                    <button className='ncb-select-members-btn' onClick={() => setSearchBarClass('')}>SELECT MEMBERS FOR YOUR COHORT BOX</button>
                                    {
                                        members.length > 0 ? (
                                            <p className='ncb-member-count'>{members.length} MEMBERS SELECTED</p>
                                        ) : (
                                            <p></p>
                                        )
                                    }
                                </div>
                                <div className='ncb-chatname'>
                                    <h4 style={{ marginBottom: '2px' }} className='ncb-chatname-heading'>CHOOSE COHORT BOX NAME</h4>
                                    <p>This should be unique</p>
                                    <input className='ncb-chatname-input' type='text' placeholder='ENTER NAME' id='chatName' onChange={e => {
                                        setChatName(e.target.value);
                                        chatNameCheck(e.target.value);
                                    }} />
                                </div>
                                <div className='ncb-chatname'>
                                    <h4 className='ncb-chatname-heading'>SELECT COHORT BOX CHAT NICHE</h4>
                                    <input className='ncb-chatname-input' type='text' placeholder='ENTER CHAT NICHE' onChange={e => setChatNiche(e.target.value)} />
                                </div>
                                <h4 className='ncb-chatname-heading'>CHAT DISPLAY PICTURE</h4>
                                <div {...getRootProps({ className: 'ncb-dropzone' })}>
                                    <input {...getInputProps()} />
                                    {isDragActive ? (
                                        <p>Drop the photo here...</p>
                                    ) : (
                                        <p>Drag & drop a photo, or click to select one</p>
                                    )}
                                </div>

                                {preview && (
                                    <div className="preview-container">
                                        <img src={preview} alt="Preview" className="preview-image" />
                                    </div>
                                )}

                                <p className='ncb-note'>Note: Your image should be under 2MB.</p>

                                <button className='ncb-add-btn' onClick={handleCreate}>CREATE</button>
                            </div>
                        </div>
                        <Toast
                            message={toastMsg}
                            show={showToast}
                            onClose={() => setShowToast(false)}
                        />
                    </div>
            }
           
        </>
    )
}

export default NewCohortBox;