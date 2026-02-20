import { useEffect, useState } from 'react';
import './Settings.css';
import NavBar from './components/NavBar';
import { useAuth } from './context/AuthContext';
import SettingsChange from './components/SettingsChange';
import { useNavigate } from 'react-router-dom';
import Toast from './components/Toast';

export default function Settings() {
    const navigate = useNavigate();
    const { accessToken } = useAuth();
    const [userDB, setUserDB] = useState(null);
    const [changeState, setChangeState] = useState(false);
    const [config, setConfig] = useState('');
    const [toastPositivity, setToastPositivity] = useState(false);
    const [toastMessage, setToastMessage] = useState("");
    const [showToast, setShowToast] = useState(false);

    function showAlert(msg, positivity) {
        setToastPositivity(positivity);
        setToastMessage(msg);
        setShowToast(true);
    }


    useEffect(() => {
        if (!accessToken) {
            navigate('/login');
        }
    }, [accessToken]);

    useEffect(() => {
        if (!accessToken) return
        fetch('/api/user', {
            method: 'GET',
            headers: {
                'authorization': `Bearer ${accessToken}`,
            },
        }).then(res => {
            if (!res.ok) {
                throw new Error('Request Failed!');
            }
            return res.json();
        }).then(data => {
            if (!data.user) throw new Error('Got No User!');
            setUserDB(data.user);
        }).catch(err => {
            console.error(err)
        })
    }, [setUserDB, accessToken])

    return (
        <div className='settings'>
            <title>Settings | CohortBox</title>
            <NavBar selectedChat={null} />
            <div className='settings-container'>
                <div className='settings-heading-container'>
                    <h1>Settings</h1>
                </div>
                <div className='settings-body-container'>
                    {userDB ?
                        <div className='settings-body'>
                            <div className='heading-container'>
                                <h1 className='acc-info-heading'>Account Information</h1>
                                <h1 className='username'>{userDB?.username}</h1>
                            </div>
                            {/* <div className='info-edit-btn-container'>
                                <div className='info-container'>
                                    <h1>Username:</h1>
                                    <p>{userDB?.username}</p>
                                </div>
                                <div></div>
                            </div> */}
                            <div className='info-edit-btn-container'>
                                <div className='dp-container'>
                                    <img src={userDB?.dp} alt='DP' />
                                </div>
                                <button onClick={() => navigate('/change-dp/profile/0')}>Change</button>
                            </div>
                            <div className='info-edit-btn-container'>
                                <div className='info-container'>
                                    <h1>Display Name</h1>
                                    <p>{userDB?.firstName + ' ' + userDB?.lastName}</p>
                                </div>
                                <button onClick={() => { setConfig('displayName'); setChangeState(true) }}>Change</button>
                            </div>
                            <div className='info-edit-btn-container'>
                                <div className='info-container about'>
                                    <h1>About</h1>
                                    <p>{userDB?.about ? userDB?.about : 'You have no About'}</p>
                                </div>
                                <button onClick={() => { setConfig('about'); setChangeState(true) }}>Change</button>
                            </div>
                            <div className='info-edit-btn-container'>
                                <div className='info-container'>
                                    <h1>Password</h1>
                                    <p>********</p>
                                </div>
                                <button onClick={() => { setConfig('password'); setChangeState(true) }}>Change</button>
                            </div>
                            <div className='info-edit-btn-container'>
                                <button onClick={() => { setConfig('deleteAcc'); setChangeState(true) }} className='delete-acc-btn'>Delete Account</button>
                            </div>
                        </div> : <div className='spinner'></div>
                    }
                </div>
                {changeState && <SettingsChange setSelfState={setChangeState} config={config} user={userDB} setUser={setUserDB} showAlert={showAlert} />}
            </div>
            <Toast
                message={toastMessage}
                show={showToast}
                positivity={toastPositivity}
                onClose={() => setShowToast(false)}
            />
        </div>
    )
}