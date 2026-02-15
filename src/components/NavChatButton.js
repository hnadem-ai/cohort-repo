import './NavChatButton.css';
import eyeImg from '../images/viewer-icon.png';
import {ReactComponent as NewMessageIcon} from '../images/new-message-icon.svg';
import {useMemo} from 'react'

function NavChatButton({ chat, selectedChat, setSelectedChat, newMessageChatIds = [], setNewMessageChatIds = (prev)=>{return} }){

    // ---------- nav-chat-button === ncbs ----------

    const isNewMessageChat = useMemo(() => {
        return newMessageChatIds.some(id => String(id) === String(chat._id));
    }, [newMessageChatIds, chat._id]);


    function handleClick(e) {
        setSelectedChat(chat);
        setNewMessageChatIds(prev =>
            prev.filter(id => String(id) !== String(chat._id))
        );
    }

    return (
        <div className={'ncbs-container' + `${String(chat._id) === String(selectedChat?._id) ? ' bg-hover' : ''}`} onClick={handleClick}>
            <div className='ncbs-img-heading-container'>
                <div className='ncbs-img-container'>
                    <img className='ncbs-img' src={chat.chatDp}/>
                </div>
                <div className='ncbs-heading-container'>
                    <h4 className='ncbs-heading'>{chat.chatName}</h4>
                    <h5 className='ncbs-sub-heading'>{chat.subscribers.length} Subscribers</h5>
                </div>
            </div>
            {
                isNewMessageChat && 
                <div className='ncbs-live-count-container'>
                    <NewMessageIcon style={{height: '30px', width: '30px'}}/>
                </div>
            }
            { chat.liveViewerCount > 0 &&
                <div className='ncbs-live-count-container'>
                    <img src={eyeImg}/>
                    {chat?.liveViewerCount}
                </div>
            }
        </div>
    )
}

export default NavChatButton;