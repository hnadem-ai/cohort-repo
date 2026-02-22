import './NavBar.css';
import { Link } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import NotificationPanel from './NotificationPanel';
import plusImg from '../images/plus.png';
import settingsImg from '../images/settings.png';
import profileImg from '../images/profile-user.png';
import peopleImg from '../images/group.png';
import logoImg from '../images/logo.png';
import menuImg from '../images/menu.png';
import notificationImg from '../images/notification.png';
import { useAuth } from '../context/AuthContext';
import { useSocket, useSocketEvent } from '../context/SocketContext';

function NavBar({ selectedChat }){
    const { socket } = useSocket();
    const { user, accessToken } = useAuth();
    const [open, setOpen] = useState(false);
    const notificationBtnRef = useRef(null);
    const [notifications, setNotifications] = useState([]);
    const [openNotification, setOpenNotification] = useState(false)
    const [isNewNotification, setIsNewNotification] = useState(false);
    const [userDB, setUserDB] = useState('');

    useEffect(() => {
        if (!accessToken) return;
        fetch('/api/notification', {
            method: 'GET',
            headers: {
                'authorization': `Bearer ${accessToken}`
            },
            credentials: 'include'
        }).then(res => {
            if (!res.ok) {
                throw new Error();
            }
            return res.json();
        }).then(data => {
            setNotifications(data.notifications);
            setIsNewNotification(false);
        }).catch(err => {
            console.error(err)
        });
    }, [accessToken]);

    useEffect(() => {
        if (!accessToken) return;
        fetch('/api/user-dp', {
            method: 'GET',
            headers: {
                'authorization': `Bearer ${accessToken}`
            },
            credentials: 'include'
        }).then(res => {
            if (!res.ok) {
                throw new Error();
            }
            return res.json();
        }).then(data => {
            setUserDB(data.dp);
        }).catch(err => {
            console.error(err)
        });
    }, [accessToken]);

    useEffect(() => {
        if (notifications.length === 0) return;
        let containsNew = false
        notifications.forEach((n) => {
            if (!n.isRead) {
                containsNew = true;
            }
        })
        if (containsNew) {
            setIsNewNotification(true);
        }
    }, [notifications, setIsNewNotification])

    useSocketEvent('notification', (notification) => {
        setNotifications(prev => [notification, ...prev]);
        if (!openNotification ) {
            setIsNewNotification(true);
        }
    }, [openNotification, setIsNewNotification])


    function handleHomeClick(e) {
        e.preventDefault();
        if (socket && selectedChat?._id) {
            socket.emit("leaveChat", selectedChat._id);
            console.log("Emitted leaveChat for:", selectedChat._id);
        }
        window.location.href = "/";
    }

    function handleNotificationClick(e){
        e.preventDefault();
        setOpenNotification(v => !v);
        setIsNewNotification(false)
        console.log('hello')
    }

    return (
        <nav className={`nav-container ${open ? 'open' : ''}`}>
            {/* Toggle button */}
            

            <section className="nav-btn-container">
                
                <button className="nav-toggle" onClick={() => setOpen(!open)}>
                    <img src={menuImg} alt="Menu" className="nav-btn-img" />
                </button>

                <Link to="/" style={{textDecoration: 'none'}} onClick={handleHomeClick}>
                    <button className="nav-btn">
                        <img src={logoImg} alt="Home" className="nav-btn-img"/>
                        <span>HOME</span>
                    </button>
                </Link>
                <Link to="/new-cohort-box" style={{textDecoration: 'none'}}>
                    <button className="nav-btn">
                        <img src={plusImg} alt="New Post" className="nav-btn-img"/>
                        <span>NEW COHORTBOX</span>
                    </button>
                </Link>
                <button ref={notificationBtnRef} className="nav-btn" onClick={handleNotificationClick}>
                    <div className='notification-img-container'>
                        <img src={notificationImg} alt="Cohort" className="nav-btn-img"/>
                        { isNewNotification && <div className='new-indicator'></div>}
                    </div>
                    <span>NOTIFICATIONS</span>
                </button>
            </section>

            <section className="nav-btn-container">
                <Link to={user ? `/profile/${user.id}` : '/login'} style={{textDecoration: 'none'}}>
                    <button className="nav-btn">
                        <img src={userDB ? userDB :  profileImg} alt="Profile" className="nav-btn-img profile-img-navbar"/>
                        <span>PROFILE</span>
                    </button>
                </Link>
                <Link to={user ? `/settings` : '/login'} style={{textDecoration: 'none'}}>
                    <button className="nav-btn">
                        <img src={settingsImg} alt="Settings" className="nav-btn-img"/>
                        <span>SETTINGS</span>
                    </button>
                </Link>
            </section>
            {
                openNotification && <NotificationPanel setIsNewNotification={setIsNewNotification} notificationBtnRef={notificationBtnRef} openNotification={openNotification} setOpenNotification={setOpenNotification} setNotifications={setNotifications} notifications={notifications}/>
            }
        </nav>
    );
}

export default NavBar;
