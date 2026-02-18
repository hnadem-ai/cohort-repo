import './Profile.css';
import dotsImg from "./images/dots.png";
import reportImg from './images/report.png';
import NavBar from './components/NavBar';
import { useAuth } from './context/AuthContext';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useState, useEffect, useMemo } from 'react';
import { useSocketEvent } from './context/SocketContext';
import NavChatButton from './components/NavChatButton';
import NavUserButton from './components/NavUserButton';
import accept from './images/check-gray.png';
import cancel from './images/close-gray.png';
import addPhoto from './images/add-photo.png'
import { useFloating, offset, flip } from '@floating-ui/react-dom';
import ReportMenu from './components/ReportMenu';

function Profile(){
    
    const [profileLoading, setProfileLoading] = useState(true);
    const { user, accessToken, logout, loading } = useAuth();
    const { id } = useParams();
    const [open, setOpen] = useState(false);
    const [userObj, setUserObj] = useState(null); 
    const [chats, setChats] = useState([]);
    const [friends, setFriends] = useState([]);
    const [friendRequests, setFriendRequests] = useState([]);
    const [showReport, setShowReport] = useState(false);
      
    const isMe = useMemo(() => {
        if (!user || !id) return false;
        return String(id) === String(user.id);
    }, [user, id]);

    const navigate = useNavigate();

    const { refs, floatingStyles } = useFloating({
        placement: "bottom-start",
        middleware: [offset(4), flip()],
    });

    const btnRef = refs.setReference;
    const menuRef = refs.setFloating;

    useEffect(() => {
        if (!accessToken && !loading) {
            navigate('/login');
        }
    }, [accessToken]);

    useEffect(() => {
        function handleClickOutside(e) {
            if (
                open &&
                refs.reference.current &&
                refs.floating.current &&
                !refs.reference.current.contains(e.target) &&
                !refs.floating.current.contains(e.target)
            ) {
                setOpen(false);
            }
        }

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [open, refs]);

    useEffect(() => {
        if(!user) return;

        fetch(`/api/user/${id}`, {
            method: 'GET',
            headers: {
                'authorization': `Bearer ${accessToken}`
            }
        }).then(response => {
            if(!response.ok){
                throw new Error('Request Failed!')
            }
            return response.json();
        }).then(data => {
            setUserObj(data.userDB);
            setFriends(data.userDB.friends)
            setProfileLoading(false);
        }).catch(err => {
            console.error(err);
            navigate('/crash')
        })    
    },[user, accessToken, id]);

    useEffect(() => {
        if(profileLoading) return;

        fetch(`/api/user-chats/${id}`, {
            method: 'GET',
            headers: {
                'authorization': `Bearer ${accessToken}`
            }
        }).then(response => {
            if(!response.ok){
                if(response.status === 404){
                    setChats([]);
                    console.log('hello')
                    return { chats: [] };
                }
                throw new Error('Request Failed!: ' + response.status);
            }
            return response.json();
        }).then(data => {
            setChats(data.chats)
        }).catch(err => {
            console.error(err);
            navigate('/crash')
        })

    },[user, profileLoading, id]);

    useEffect(() => {
        if (!accessToken || profileLoading) return;
        fetch(`/api/friend-requests`, {
        method: 'GET',
        headers: { authorization: `Bearer ${accessToken}` },
        credentials: 'include',
        })
        .then(r => {
            if (!r.ok) throw new Error('Request Failed with Status: ' + r.status);
            return r.json();
        })
        .then(data => setFriendRequests(data.requests || []))
        .catch(err => {
            console.error('Error fetching friend requests:', err);
            navigate('/crash');
        });
    }, [accessToken, profileLoading]);

    useSocketEvent(
    'unfriend',
    (userId) => {
        setFriends(prev =>
            prev.filter(friend => !(String(friend._id) === String(userId) ))
        );
    },
    [user]
    );

    function handleLogout(){
        logout();
        navigate('/login');
    }
    
    const friendIds = useMemo(
        () => new Set(friends?.map(f => String(f._id))),
        [friends]
      );
    
      const outgoingPending = useMemo(
        () =>
          new Set(
            friendRequests
              .filter(r => String(r.from._id) === String(user?.id) && r.status === 'pending')
              .map(r => String(r.to._id))
          ),
        [friendRequests, user?.id]
      );
    
      const incomingPending = useMemo(
        () =>
          new Set(
            friendRequests
              .filter(r => String(r.to._id) === String(user?.id) && r.status === 'pending')
              .map(r => String(r.from._id))
          ),
        [friendRequests, user?.id]
      );
    

    return (
        <div className='profile-container'>
            <title>Profile | CohortBox</title>
            <NavBar/>
            <div className='profile-body-container'>
                <div className='profile-heading-container'>
                    <h1 className='profile-heading'>Profile</h1>
                </div>
                { profileLoading ? ( <div className='spinner-container'><div className='spinner'></div></div> ) : (
                    <div className='profile-info-section'>
                        <div className='profile-info-heading-container'>
                            <div className='profile-info-heading'>
                                <div className='profile-img-container'>
                                    <img className='profile-img' src={userObj.dp}/>
                                    { isMe &&
                                        <div className='photo-change-btn'>
                                            <img className='photo-change-img' onClick={() => navigate('/change-dp/profile/0')} src={addPhoto}/>
                                        </div>
                                    }
                                </div>
                                <div className='name-username-container'>
                                    <h1 className='profile-username'>{userObj.username}</h1>
                                    <h1 className='profile-name'>{userObj.firstName + ' ' + userObj.lastName}</h1>
                                    {userObj.about && <h1 className='profile-about'>{userObj.about}</h1>}
                                </div>
                            </div>
                            <div className='profile-btns-container'>
                                {
                                    userObj._id !== user.id && (
                                        <div className='profile-menu-container'>
                                            <button
                                                ref={btnRef}
                                                className="pm-btn"
                                                onClick={() => setOpen((prev) => !prev)}
                                            >
                                                <img className="pm-btn-img" src={dotsImg} alt="menu" />
                                            </button>
                                            {open && (
                                                <div ref={menuRef} style={floatingStyles} className="pm-menu-container">
                                                    <button className="pm-inner-btn" onClick={() => { setShowReport(true) }}> <img className="pm-img" src={reportImg} /> Report User</button>
                                                </div>
                                            )}
                                        </div>
                                    )
                                }
                                {userObj._id === user.id ? (
                                    <button className='profile-logout-btn' onClick={handleLogout}>Logout</button>
                                ) : (
                                    <div className='profile-actions'>
                                        {(() => {
                                            const id = String(userObj._id);
                                            if (friendIds.has(id)) {
                                                return (
                                                    <button className='profile-action-btn unfriend-btn'>
                                                        Unfriend
                                                    </button>
                                                );
                                            }
                                            if (outgoingPending.has(id)) {
                                                return (
                                                    <button className='profile-action-btn cancel-btn'>
                                                        Cancel Request
                                                    </button>
                                                );
                                            }
                                            if (incomingPending.has(id)) {
                                                return (
                                                    <div className='profile-request-actions'>
                                                        <button className='accept-btn'>
                                                            <img className="request-btn-img" src={accept} alt="accept" />
                                                        </button>
                                                        <button className='reject-btn'>
                                                            <img className="request-btn-img" src={cancel} alt="reject" />
                                                        </button>
                                                    </div>
                                                );
                                            }
                                            return (
                                                <button className='profile-action-btn add-btn'>
                                                    Add Friend
                                                </button>
                                            );
                                        })()}
                                    </div>
                                ) }
                            </div>
                        </div>

                        <div className='profile-nav-container'>
                            <div className='profile-nav-body'>
                                <div className='profile-chats-container'>
                                    <h4 className='profile-chats-heading'>Cohort Boxes</h4>
                                    { chats.length > 0 ? (
                                        chats.map((chat, index) => (
                                            <Link to={'/' + chat._id} style={{textDecoration: 'none'}}><NavChatButton key={index} chat={chat} setSelectedChat={()=> {return}}/></Link>
                                        )) ) : (
                                            <div className='no-cohort-boxes'>
                                                { isMe ? 'You have no Cohort Boxes!' : "This user has no Cohort Boxes!" }
                                            </div>
                                        )
                                    }
                                </div>
                                <div className='profile-friends-container'>
                                    <h4 className='profile-friends-heading'>Friends</h4>
                                    { friends?.length > 0 ? (
                                        friends.map((friend, index) => {
                                            const id = String(friend._id);
                                            const isFriend = friendIds.has(id);
                                            const sentRequest = outgoingPending.has(id);
                                            const gotRequest = incomingPending.has(id);
                                            return <Link to={'/profile/' + friend._id} style={{textDecoration: 'none'}}><NavUserButton key={index} user={friend} isFriend={isFriend} sentRequest={sentRequest} gotRequest={gotRequest} setSelectedChat={()=> {return}}/></Link>
                                        }))  : (
                                            <div className='no-friends'>
                                                { isMe ? 'You have no Friends!' : "This user has no Friends!" }
                                            </div>
                                        )
                                    }
                                </div>
                            </div>
                        </div>
                    </div> 
                )}
            </div>
            { showReport && <ReportMenu targetId={userObj._id} targetModel={'User'} setSelfState={setShowReport}/>}
        </div>
    )
}

export default Profile;