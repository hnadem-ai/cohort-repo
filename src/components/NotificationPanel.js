import './NotificationPanel.css';
import { useEffect, useRef, useState } from 'react';
import Notification from './Notification';

export default function NotificationPanel({notificationBtnRef, openNotification, setOpenNotification, setNotifications, notifications}){
    const panelRef = useRef(null);

    useEffect(() => {
        function handleClickOutside(e) {
            if (
                panelRef.current &&
                !panelRef.current.contains(e.target) &&
                notificationBtnRef.current &&
                !notificationBtnRef.current.contains(e.target)
            ) {
                setOpenNotification(false)
            }
        }

        if (openNotification) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [openNotification])

    return (
        <div ref={panelRef} className='np-container'>
            <h1>NOTIFICATIONS</h1>
            <div className='notifications-container'>
                { notifications.length > 0 ? 
                    notifications.map((not, index) => (
                        <Notification notification={not} setNotifications={setNotifications} key={index}/>
                    )) : (
                        <p className='no-notifications'>There are no notifications for you!</p>
                    )
                }
            </div>
        </div>
    )
}