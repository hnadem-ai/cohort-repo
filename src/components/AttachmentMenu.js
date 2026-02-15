import { useEffect, useRef, useState } from 'react';
import './AttachmentMenu.css';
import paperClip from '../images/clip.png';
import Toast from './Toast';

function AttachmentMenu({ setFiles }){
    const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
    const MAX_FILES = 5;

    const btnRef = useRef(null);
    const menuRef = useRef(null);
    const [open, setOpen] = useState(false);

    const [toastMessage, setToastMessage] = useState("");
    const [showToast, setShowToast] = useState(false);

    function showAlert(msg) {
        setToastMessage(msg);
        setShowToast(true);
    }

    useEffect(() => {

        function handleClickOutside(e){
            if(
                menuRef.current &&
                !menuRef.current.contains(e.target) &&
                btnRef.current &&
                !btnRef.current.contains(e.target)
            ){
                setOpen(false)
            }
        }

        if(open){
            document.addEventListener('mousedown', handleClickOutside);
        } else {
            document.removeEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [open])

    function handleOpen(e){
        e.preventDefault();
        setOpen(!open);
    }

    function handleFileChange(e) {
        const selectedFiles = Array.from(e.target.files);

        // Check max file count
        if (selectedFiles.length > MAX_FILES) {
            showAlert("You can only upload up to 5 files.");
            e.target.value = null;
            return;
        }

        // Check file sizes
        const hasInvalidFile = selectedFiles.some(file => {
            if (file.size > MAX_FILE_SIZE) {
                showAlert(`${file.name} exceeds 2MB size limit.`);
                return true;
            }
            return false;
        });

        // If any file is invalid → stop completely
        if (hasInvalidFile) {
            e.target.value = null;
            return;
        }

        // Only runs if ALL files are valid
        setFiles(selectedFiles);

        e.target.value = null;
        setOpen(false);
    }

    return (
        <div className='am-container'>
            <button type='button' ref={btnRef} className='am-btn' onClick={(e) => handleOpen(e)}><img className='am-btn-img' src={paperClip}/></button>
            {
                open && (
                    <div className='am-menu-container' ref={menuRef}>
                        <label for="file-upload" class="custom-file-upload">
                            Add Photos & Videos
                        </label>
                        <input id="file-upload" type="file" accept='image/*, video/*' multiple onChange={handleFileChange}/>
                    </div>
                )
            }
            <Toast
                message={toastMessage}
                show={showToast}
                onClose={() => setShowToast(false)}
            />
        </div>
    )
}

export default AttachmentMenu;