import './Notification.css';
import { useAuth } from '../context/AuthContext';
import { useSocket, useSocketEvent } from '../context/SocketContext';
import accept from '../images/check-gray.png';
import cancel from '../images/close-gray.png';
import deleteIcon from '../images/trash-fontcolor.png';
import Toast from './Toast'
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Notification({notification, setNotifications}){
    console.log(notification)
    const { user, accessToken } = useAuth();
    const { socket } = useSocket();
    const [toastMsg, setToastMsg] = useState('');
    const [showToast, setShowToast] = useState(false);
    const navigate = useNavigate();

    function showAlert(msg){
        setToastMsg(msg);
        setShowToast(true)
    }

    useSocketEvent('acceptFriendRequest', () => {
        
    }, [])

    const callApi = async (url, method, body = null) => {
        const res = await fetch(`${url}`, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'authorization': `Bearer ${accessToken}`
            },
            credentials: 'include',
            body: body ? JSON.stringify(body) : null,
        });

        if (!res.ok) {
            console.log('Failed!')
            const err = await res.json().catch(() => ({}));
            showAlert('Server failed!')
            throw new Error(err.error || `API failed: ${url}`);
        }

        return res.json();
    };

    const handleAccept = async (e) => {
        e.preventDefault();
        try {
            const result = await callApi(`/api/friends/accept/${notification.sender._id}`, 'POST');
            socket.emit('acceptFriendRequest', notification.sender._id);
            socket.emit('notification', result.notification)
            setNotifications(prev => prev.filter(currNotification => currNotification._id !== notification._id))
        } catch (err) {
            console.error(err);
            navigate('/crash')
        }
    };

    const handleReject = async (e) => {
        e.preventDefault();
        try {
            const result = await callApi(`/api/friends/reject/${notification.sender._id}`, 'POST');
            socket.emit('rejectFriendRequest', result);
            socket.emit('notification', result.notification);
            setNotifications(prev => prev.filter(currNotification => currNotification._id !== notification._id))
        } catch (err) {
            console.error(err);
        }
    };

        const handleChatAccept = async (e) => {
            e.preventDefault();
            try {
                const result = await callApi(`/api/chat/accept/${notification.chat._id}`, 'POST');
                socket.emit('notification', result.notification);
                console.log(result.notification)
                const messageRes = await fetch('/api/message', {
                    method: 'POST',
                    headers: {
                        'authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        from: result.notification.chat.chatAdmin,
                        chatId: notification.chat._id,
                        type: 'chatInfo',
                        message: `${user.username} has joined this chat.`,
                        isReply: false,
                        repliedTo: null,
                        media: [],
                        reactions: []
                    })
                })
                if (!messageRes.ok) {
                    throw new Error();
                }
                console.log('hoguya');
                const data = await messageRes.json();
                socket.emit('message', data.message);
                socket.emit('participantAccepted', {chatId: notification.chat._id})
                setNotifications(prev => prev.filter(currNotification => currNotification._id !== notification._id))
            } catch (err) {
                console.error(err);
                navigate('/crash')
            }
        };

    const handleChatReject = async (e) => {
        e.preventDefault();
        try {
            const result = await callApi(`/api/chat/reject/${notification.chat._id}`, 'POST');
            setNotifications(prev => prev.filter(currNotification => currNotification._id !== notification._id))
        } catch (err) {
            console.error(err);
        }
    };

    const deleteNotification = async (e) => {
        try{
            const res = await fetch(`/api/notification/${notification._id}`, {
                method: 'DELETE',
                headers: {
                    'authorization': `Bearer ${accessToken}`,
                },
            })
            if(!res.ok){
                throw new Error();
            }
            setNotifications(prev => prev.filter(n => n._id !== notification._id))
        } catch (err) {
            console.error(err);
            navigate('/crash');
        }
    }
    let notificationImg;
    let message;
    if (notification.type === 'friend_request_received') {
        //message = `${notification.sender.username} sent you a Friend Request!`
        message = (
            <p><span className='notification-highlight'>{notification.sender.username}</span> sent you a Friend Request!</p>
        )
        notificationImg = notification.sender.dp;
    } else if (notification.type === 'friend_request_accepted') {
        //message = `${notification.sender.username} accepted your Friend Request!`
        message = (
            <p><span className='notification-highlight'>{notification.sender.username}</span> accepted your Friend Request!</p>
        )
        notificationImg = notification.sender.dp;
    } else if (notification.type === 'added_to_group_request') {
        //message = `${notification.sender.username} wants you to join a new CohortBox: ${notification.chat.chatName}`
        message = (
            <p><span className='notification-highlight'>{notification.sender.username}</span> wants you to join a new CohortBox: <span className='notification-highlight-small bold'>{notification.chatName}</span></p>
        )
        notificationImg = notification.chat.chatDp;
    } else if (notification.type === 'accepted_group_request') {
        //message = `${notification.sender.username} accepted your request to join the CohortBox: ${notification.chat.chatName}`
        message = (
            <p><span className='notification-highlight bold'>{notification.sender.username}</span> accepted your request to join the CohortBox: <span className='notification-highlight-small bold'>{notification.chat.chatName}</span></p>
        )
        notificationImg = notification.chat.chatDp;
    } else if (notification.type === 'welcome'){
        message = (
            <p><span className='notification-highlight bold'>WELCOME</span> to CohortBox <span className='notification-highlight-small bold'>{user.username}</span></p>
        )
        notificationImg = notification.sender.dp;
    }
    if(notification.type === 'chat_participant_joined') return;
    return (
        <div className='notification-container'>
            <img className='notification-img' src={notificationImg}/>
            <p className='notification-msg'>{message}</p>
            {
                notification.type === 'friend_request_received' &&
                (
                    <div className="nub-btn got-request-btn">
                        <div className="request-btns">
                            <button onClick={handleAccept}>
                                <img className="request-btn-img" src={accept} alt="accept" />
                            </button>
                            <button onClick={handleReject}>
                                <img className="request-btn-img" src={cancel} alt="reject" />
                            </button>
                        </div>
                    </div>
                )
            }
            {
                notification.type === 'added_to_group_request' &&
                (
                    <div className="nub-btn got-request-btn">
                        <div className="request-btns">
                            <button onClick={handleChatAccept}>
                                <img className="request-btn-img" src={accept} alt="accept" />
                            </button>
                            <button onClick={handleChatReject}>
                                <img className="request-btn-img" src={cancel} alt="reject" />
                            </button>
                        </div>
                    </div>
                )
            }
            { notification.type !== 'added_to_group_request' && notification.type !== 'friend_request_received' &&
                <div className='delete-container' onClick={deleteNotification}>
                    <img src={deleteIcon} className='delete'/>
                </div>
            }
            <Toast message={toastMsg} show={showToast} onClose={() => setShowToast(false)} />
        </div>
    )
}