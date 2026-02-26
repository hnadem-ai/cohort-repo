import './LoadingScreen.css';
import logoPng from '../images/logo.png';

export default function LoadingScreen(){
    return (
        <div className='loading-screen'>
            <div className='logo-container'>
                <img src={logoPng} />
            </div>
            <div className='name-container'>
                <h1>COHORTBOX.COM</h1>
            </div>
        </div>
    )
}