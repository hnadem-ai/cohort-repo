import { useAuth } from '../context/AuthContext.js';
import './AudioMessage.css';
import AudioPlayer from './AudioPlayer.js';
import MessageMenu from './MessageMenu.js';
import ReactionMenu from './ReactMenu.js';
import ReactionsMenu from './ReactionsMenu.js';
import { useEffect, useState } from 'react';

export default function AudioMessage({ newSender, setIsReply, setRepliedTo, msg, setMessages, sender, selectedChat, setClickedMsg }){
    const { user } = useAuth();
    const [pop, setPop] = useState(false);
    const senderColors = ['#c76060', '#c79569', '#c7c569', '#6ec769', '#69c2c7', '#6974c7', '#9769c7', '#c769bf']

    const senderIndex = sender 
    ? selectedChat.participants.findIndex(p => p._id === sender._id)
    : 0;

    useEffect(() => {
        const now = Date.now();
        const msgTime = new Date(msg.timestamp).getTime();

        // animate only if message is fresh (< 3s old)
        if (now - msgTime > 3000) return;
        console.log('hello after pop true!')
        setPop(true);
        const t = setTimeout(() => setPop(false), 220);
        return () => clearTimeout(t);
    }, [msg.timestamp]);

    function groupReactions(reactions = []) {
        const map = {};
        for (let r of reactions) {
            if (!map[r.emoji]) map[r.emoji] = 0;
        }
        return Object.entries(map).map(([emoji, count]) => ({ emoji, count }));
    }

    function formatTime(ts) {
        const date = new Date(ts);
        return date.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    return(
        <div className={user.id === msg.from._id ? 'my-msg-container' : 'other-msg-container'} onClick={() => setClickedMsg(msg)}>
            {String(msg.from._id) !== String(user.id) &&
                <div className='msg-user-dp-container'>
                    <img className='msg-user-dp' src={msg.from.dp} />
                </div>
            }
            <div className='msg-menu-btns-container'>
                <div className={msg.from._id === user.id ? `my-media-msg ${msg?.reactions?.length > 0 ? 'has-reactions' : ''} ${newSender ? 'right' : ''} ${pop ? 'msg-pop' : ''}` : `other-media-msg ${msg?.reactions?.length > 0 ? 'has-reactions' : ''} ${newSender ? 'left' : ''} ${pop ? 'msg-pop' : ''}`}>
                    {msg.from._id !== user.id &&
                        <div className='name-menu-container'>
                            {msg.from._id !== user.id && sender && newSender && (
                                <h4 className='sender-name' style={{ color: `${senderColors[senderIndex]}` }}>{sender.username}</h4>
                            )}
                        </div>
                    }
                    {msg.isReply && msg.repliedTo && (
                        <div className="reply-msg-container">
                            <h1>
                                {msg.repliedTo.from?.firstName || ''}{' '}
                                {msg.repliedTo.from?.lastName || ''}
                            </h1>

                            <p>
                                {msg.repliedTo.type === 'text' && msg.repliedTo.message}

                                {msg.repliedTo.type === 'media' &&
                                    `${msg.repliedTo.media?.length || 0} media`}

                                {msg.repliedTo.type === 'audio' && 'Audio Message'}
                            </p>
                        </div>
                    )}
                    <div className='msg-media-wrapper audio-msg-wrapper' onClick={() => { return }}>
                        <div className='audio-container'>
                            <AudioPlayer src={msg.media[0].url} />
                        </div>
                    </div>
                    <span className="msg-time">{formatTime(msg.timestamp)}</span>
                    {msg.reactions?.length > 0 && (
                        <div className={String(msg.from._id) === String(user.id) ? "my-reactions" : "other-reactions"}>
                            <ReactionsMenu reactions={msg.reactions} msgId={msg._id} selectedChat={selectedChat} />
                        </div>
                    )}
                </div>
                <MessageMenu setIsReply={setIsReply} setRepliedTo={setRepliedTo} msg={msg} setMessages={setMessages}/>
                <ReactionMenu msg={msg}/>
            </div>
        </div>  
    )
}