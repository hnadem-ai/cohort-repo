import './LiveChatCommentsView.css';
import { useState, useEffect, useRef } from 'react';
import { ReactComponent as MyIcon } from '../images/send.svg';
import { useAuth } from '../context/AuthContext';
import closeImg from '../images/close-gray.png';
import { useSocket, useSocketEvent } from '../context/SocketContext';
import LiveCommentMenu from './LiveCommentMenu';

export default function LiveChatView({ selectedChat, setShowLiveChat }) {
    const senderColors = [
        '#4fc3f7', '#ff8a65', '#7986cb', '#dce775', '#ba68c8',
        '#81c784', '#f06292', '#90a4ae', '#ffd54f', '#64b5f6',
        '#a1887f', '#4dd0e1', '#ce93d8', '#ffb74d', '#9575cd',
        '#b0bec5', '#e57373', '#aed581', '#4db6ac', '#fff176',

        '#ff7043', '#8c9eff', '#80deea', '#ffca28', '#c5e1a5',
        '#f48fb1', '#b39ddb', '#9fa8da', '#80cbc4', '#ffe082',
        '#bcaaa4', '#81d4fa', '#e1bee7', '#ffab91', '#9ccc65',
        '#cfd8dc', '#ff9e80', '#82b1ff', '#a5d6a7', '#b2ebf2'
    ];

    const { socket } = useSocket();
    const { user, accessToken } = useAuth();
    const [comments, setComments] = useState([]);
    const [message, setMessage] = useState('');
    const [pinnedComment, setPinnedComment] = useState(null);
    const [cooldown, setCooldown] = useState(false);

    const bottomRef = useRef(null);

    useSocketEvent('liveComment', ({ chatId, comment }) => {
        console.log('A live comment came')
        if (String(chatId) === String(selectedChat._id)) {
            if (comment.from._id !== user.id) {
                setComments(prev => [...prev, comment]);
            }

        }
    })

    useSocketEvent('liveCommentPin', ({ chatId, comment }) => {
        console.log('hello from liveCommentPin', comment, chatId)
        if (chatId === selectedChat._id) {
            setPinnedComment(comment);
        }
    })

    useEffect(() => {
        if (!pinnedComment) return;

        const timer = setTimeout(() => {
            setPinnedComment(null);
        }, 18000); // 30 seconds

        return () => clearTimeout(timer);
    }, [pinnedComment]);

    useEffect(() => {
        setPinnedComment(null);
    }, [selectedChat])

    useEffect(() => {
        if (!selectedChat) return;
        setComments(!selectedChat.liveComments ? [] : selectedChat.liveComments);
    }, [selectedChat, setComments])

    function sendComment() {
        if(cooldown) return;
        if (!message || !message.trim()) return;
        const payload = {
            chatId: selectedChat._id,
            message,
            repliedTo: null,
        }

        setCooldown(true);

        fetch('/api/live-comment', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'authorization': `Bearer ${accessToken}`,
            },
            body: JSON.stringify(payload),
        }).then(res => {
            if (!res.ok) {
                throw new Error('Request Failed!');
            }
            return res.json();
        }).then(data => {
            if (data.comment) {
                setComments(prev => [...prev, data.comment]);
                socket.emit('liveComment', { chatId: selectedChat._id, comment: data.comment });
                console.log('Comment Successfully created');
            }
        }).catch(err => {
            console.log(err)
        })
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        setMessage('');

        setTimeout(() => {
            setCooldown(false);
        }, 5000);
    }

    return (
        <div className='live-chat-container'>
            <div className='live-chat-header'>
                <h1>Live Chat</h1>
                <button className='live-chat-close-btn' onClick={(e) => setShowLiveChat(false)}><img className='live-chat-close-img' src={closeImg} /></button>
            </div>
            {
                pinnedComment &&
                <div className='pinned-comment-container'>
                    <div className='comment'>
                        <p className='comment-msg'><span className='comment-username' style={{ color: senderColors[Math.floor(Math.random() * senderColors.length - 1)] }}>{pinnedComment?.from.username}:</span> {pinnedComment?.message}</p>
                    </div>
                </div>
            }
            <div className='live-chat-comments-container'>
                {
                    comments.length === 0 ? (
                        <p>No Comments!</p>
                    ) : comments.map((value, index) => (
                        <div key={index} className='comment'>

                            <p className='comment-msg'><span className='comment-username' style={{ color: senderColors[index % senderColors.length] }}>{value.from.username}:</span> {value.message}</p>
                            <LiveCommentMenu selectedChat={selectedChat} comment={value} />
                        </div>
                    ))
                }
                <div ref={bottomRef} />
            </div>
            <div className='comment-msg-input-container'>
                <input
                    type='text'
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendComment()}
                    placeholder='Comment Live'
                />
                <button disabled={cooldown ? true : false} onClick={sendComment}><MyIcon fill='#c5cad3' style={{ width: '30px', height: '30px', fill: '#c5cad3' }} /></button>
            </div>
        </div>
    )
}