// =====================================
// BAMBU LAB A1 - G-CODE CONVERTER
// Web Version - HTML/CSS/JS
// Nozzle-based Eject Logic (UPDATED with user-provided Eject Test)
// ===================================== 

// ===== CONFIGURATION =====
const CONFIG = {
    colors: {
        primary: '#3498DB',
        secondary: '#2C3E50',
        success: '#27AE60',
        error: '#E74C3C',
        warning: '#F39C12'
    },
    validFileTypes: ['.gcode.3mf', '.3mf'],
    maxFileSize: 100 * 1024 * 1024 // 100MB
};

// ===== STATE =====
const state = {
    selectedFile: null,
    selectedFileName: '',
    isProcessing: false,
    outputFile: null
};

// ===== DOM ELEMENTS =====
const elements = {
    dragDropZone: document.getElementById('dragDropZone'),
    fileInput: document.getElementById('fileInput'),
    fileInfo: document.querySelector('.file-info'),
    ejectCheckbox: document.getElementById('enableEject'),
    repeatCountInput: document.getElementById('repeatCount'),
    processBtn: document.getElementById('processBtn'),
    downloadBtn: document.getElementById('downloadBtn'),
    progressBar: document.querySelector('.progress-bar'),
    progressFill: document.querySelector('.progress-fill'),
    statusLabel: document.querySelector('.status-label')
};

// ===== INITIALIZATION =====
function init() {
    setupEventListeners();
}

function setupEventListeners() {
    // Drag and drop
    elements.dragDropZone.addEventListener('click', () => elements.fileInput.click());
    elements.dragDropZone.addEventListener('dragover', handleDragOver);
    elements.dragDropZone.addEventListener('dragleave', handleDragLeave);
    elements.dragDropZone.addEventListener('drop', handleDrop);

    // File input
    elements.fileInput.addEventListener('change', handleFileSelect);

    // Process button
    elements.processBtn.addEventListener('click', processFile);

    // Download button
    elements.downloadBtn.addEventListener('click', downloadFile);
}

// ===== DRAG AND DROP HANDLERS =====
function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    elements.dragDropZone.classList.add('dragover');
}

function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    elements.dragDropZone.classList.remove('dragover');
}

function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    elements.dragDropZone.classList.remove('dragover');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
        elements.fileInput.files = files;
        handleFileSelect();
    }
}

// ===== FILE SELECTION =====
function handleFileSelect() {
    const file = elements.fileInput.files[0];
    
    if (!file) {
        updateFileInfo('❌ No file selected', 'error');
        return;
    }

    // Validate file type
    const isValidType = CONFIG.validFileTypes.some(ext => file.name.endsWith(ext));
    if (!isValidType) {
        updateFileInfo('❌ Invalid file! Please select .gcode.3mf or .3mf file', 'error');
        elements.fileInput.value = '';
        return;
    }

    // Validate file size
    if (file.size > CONFIG.maxFileSize) {
        updateFileInfo(`❌ File too large! (${(file.size / (1024 * 1024)).toFixed(2)}MB > 100MB)`, 'error');
        elements.fileInput.value = '';
        return;
    }

    state.selectedFile = file;
    state.selectedFileName = file.name;
    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
    
    updateFileInfo(`✓ File: ${file.name} (${fileSizeMB} MB)`, 'success');
    elements.processBtn.disabled = false;
}

function updateFileInfo(message, type) {
    elements.fileInfo.textContent = message;
    elements.fileInfo.className = `file-info ${type}`;
}

// ===== PROCESS FILE =====
async function processFile() {
    if (!state.selectedFile) {
        showAlert('⚠️ Warning', 'Please select a file!', 'warning');
        return;
    }

    if (state.isProcessing) {
        showAlert('ℹ️ Info', 'Processing file, please wait...', 'info');
        return;
    }

    state.isProcessing = true;
    elements.processBtn.disabled = true;
    
    showProgress(true);
    updateStatus('⏳ Processing... (extracting → modifying gcode → packaging)', 'info');

    try {
        // Import JSZip library
        if (typeof JSZip === 'undefined') {
            await loadJSZipLibrary();
        }

        // Process the file
        const processedFile = await processGcodeFile(state.selectedFile);
        state.outputFile = processedFile;

        // Success
        showProgress(false);
        updateStatus('✓ Success! File ready to download', 'success');
        elements.downloadBtn.classList.add('show');

        const repeatCount = parseInt(elements.repeatCountInput.value);
        const enableEject = elements.ejectCheckbox.checked;

        showAlert(
            '✓ Success!',
            `File processed successfully!\n\n` +
            `📄 File: ${state.selectedFileName}\n` +
            `📁 Ready to download\n\n` +
            `⚙️ Settings:\n` +
            `  • Eject: ${enableEject ? '✓ Enabled' : '✗ Disabled'}\n` +
            `  • Loops: ${repeatCount}\n\n` +
            `💡 Tip: Open this file in Bambu Studio to preview before printing.`,
            'success'
        );

    } catch (error) {
        console.error('Error processing file:', error);
        showProgress(false);
        updateStatus(`✗ Error: ${error.message.substring(0, 100)}...`, 'error');
        showAlert('❌ Error', `Error processing file:\n${error.message}`, 'error');
    } finally {
        state.isProcessing = false;
        elements.processBtn.disabled = false;
    }
}

// ===== GCODE PROCESSING =====
async function processGcodeFile(file) {
    try {
        // Read file as array buffer
        const arrayBuffer = await file.arrayBuffer();
        const zip = new JSZip();
        
        // Load zip
        const loadedZip = await zip.loadAsync(arrayBuffer);
        
        // Find and read gcode file
        let gcodeFile = null;
        let gcodeFilePath = null;

        // Try common paths first
        const possiblePaths = [
            'Metadata/print.gcode',
            'print.gcode',
            'Metadata/model_inst.gcode'
        ];

        for (const path of possiblePaths) {
            if (loadedZip.file(path)) {
                gcodeFile = loadedZip.file(path);
                gcodeFilePath = path;
                break;
            }
        }

        // If not found, search all files
        if (!gcodeFile) {
            for (const [path, file] of Object.entries(loadedZip.files)) {
                if (path.endsWith('.gcode') && !path.startsWith('__MACOSX')) {
                    gcodeFile = file;
                    gcodeFilePath = path;
                    break;
                }
            }
        }

        if (!gcodeFile) {
            throw new Error('G-code file not found in archive');
        }

        // Read gcode content
        let gcodeContent = await gcodeFile.async('string');

        // Process gcode
        const repeatCount = parseInt(elements.repeatCountInput.value);
        const enableEject = elements.ejectCheckbox.checked;

        if (enableEject) {
            if (repeatCount > 1) {
                gcodeContent = createLoopWithEject(gcodeContent, repeatCount);
            } else {
                gcodeContent = addEjectRoutine(gcodeContent);
            }
        } else {
            if (repeatCount > 1) {
                gcodeContent = createLoopWithoutEject(gcodeContent, repeatCount);
            }
        }

        // Update zip with new gcode
        loadedZip.file(gcodeFilePath, gcodeContent);

        // Generate output filename
        const outputFileName = state.selectedFileName.replace('.gcode.3mf', '_converted.gcode.3mf')
                                                      .replace('.3mf', '_converted.3mf');

        // Generate new zip file
        const newZipContent = await loadedZip.generateAsync({ type: 'blob' });
        
        return new File([newZipContent], outputFileName, { type: 'application/octet-stream' });

    } catch (error) {
        throw new Error(`Error processing G-code: ${error.message}`);
    }
}

// ===== GCODE GENERATION - UPDATED EJECT (USER PROVIDED) =====
function generateEjectGcode() {
    const ejectGcode = `;==========================\n; Bambu A1 - Eject Test (Working Version)\n;==========================\n\nM400\nM104 S0\nM140 S0\nM106 S0\nG90\n\n; --- Nâng đầu in an toàn ---\nG1 Z250 F3000\nM400\n\n; --- Đẩy bàn ra trước hết cỡ (Y max) ---\nG1 Y256 F9000       ; <- GIỚI HẠN CHUẨN CỦA A1\nM400\n\n; --- Hạ đầu in xuống gần mẫu ---\nG1 Z5 F2000\nG4 P500\n\n; --- Đưa đầu in vào giữa bàn ---\nG1 X128 F6000\nM400\n\n; === ĐẨY MẠNH 3 LẦN ===\n\n; Lần 1\nG1 Y0 F9000         ; Kéo hết về sau\nG1 Y256 F9000       ; Đẩy ra trước lại\n\n; Lần 2\nG1 Y0 F9000\nG1 Y256 F9000\n\n; Lần 3\nG1 Y0 F9000\nG1 Y256 F9000\n\n; --- Kết thúc ---\nG1 Z250 F3000\nG1 X0 Y0 F6000\nM400\nM300 S1000 P200\n\n;==========================\n; END EJECT TEST\n;==========================\n`;
    return ejectGcode;
}

function addEjectRoutine(gcodeContent) {
    const ejectGcode = generateEjectGcode();
    return gcodeContent + '\n' + ejectGcode;
}

function createLoopWithEject(gcodeContent, repeatCount) {
    const lines = gcodeContent.split('\n');
    
    // Find start of actual print
    let startPrintIdx = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if ((line.startsWith('G1') || line.startsWith('G0') || line.startsWith('G28') || line.startsWith('G29')) && i > 5) {
            startPrintIdx = i;
            break;
        }
    }

    const header = lines.slice(0, startPrintIdx).join('\n');
    const body = lines.slice(startPrintIdx).join('\n');
    const ejectGcode = generateEjectGcode();

    let result = header + '\n';
    result += `\n; ========================================\n`;
    result += `; REPEAT LOOP - ${repeatCount} times\n`;
    result += `; ========================================\n`;

    for (let loopNum = 1; loopNum <= repeatCount; loopNum++) {
        result += `\n; --- LOOP ${loopNum}/${repeatCount} ---\n`;
        result += body;
        result += ejectGcode;

        if (loopNum < repeatCount) {
            result += '\nG4 P2000                ; Wait 2s before next loop\n';
        }
    }

    result += `\n; ========================================\n`;
    result += `; END REPEAT LOOP\n`;
    result += `; ========================================\n`;

    return result;
}

function createLoopWithoutEject(gcodeContent, repeatCount) {
    const lines = gcodeContent.split('\n');
    
    let startPrintIdx = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if ((line.startsWith('G1') || line.startsWith('G0')) && i > 5) {
            startPrintIdx = i;
            break;
        }
    }

    const header = lines.slice(0, startPrintIdx).join('\n');
    const body = lines.slice(startPrintIdx).join('\n');

    let result = header + '\n';
    result += `\n; REPEAT LOOP - ${repeatCount} times\n`;

    for (let loopNum = 1; loopNum <= repeatCount; loopNum++) {
        result += `\n; --- LOOP ${loopNum}/${repeatCount} ---\n`;
        result += body;

        if (loopNum < repeatCount) {
            result += '\nG4 P2000\n';
        }
    }

    return result;
}

// ===== DOWNLOAD FILE =====
function downloadFile() {
    if (!state.outputFile) {
        showAlert('⚠️ Warning', 'No file to download!', 'warning');
        return;
    }

    const url = URL.createObjectURL(state.outputFile);
    const a = document.createElement('a');
    a.href = url;
    a.download = state.outputFile.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showAlert('✓ Success!', `File ${state.outputFile.name} downloaded!`, 'success');
}

// ===== UI HELPERS =====
function showProgress(show) {
    if (show) {
        elements.progressBar.classList.add('show');
        animateProgress();
    } else {
        elements.progressBar.classList.remove('show');
        elements.progressFill.style.width = '0%';
    }
}

function animateProgress() {
    let width = 0;
    const interval = setInterval(() => {
        if (width >= 90) {
            clearInterval(interval);
            return;
        }
        width += Math.random() * 30;
        elements.progressFill.style.width = Math.min(width, 90) + '%';
    }, 300);
}

function updateStatus(message, type) {
    elements.statusLabel.textContent = message;
    elements.statusLabel.className = `status-label show ${type}`;
    elements.statusLabel.classList.add('fade-in');
}

function showAlert(title, message, type) {
    const modal = document.createElement('div');
    modal.className = 'modal show';
    
    const iconMap = {
        'success': '✓',
        'error': '❌',
        'warning': '⚠️',
        'info': 'ℹ️'
    };

    modal.innerHTML = `\n        <div class="modal-content">\n            <h3>${iconMap[type] || 'ℹ️'} ${title}</h3>\n            <p>${message.replace(/\n/g, '<br>')}</p>\n            <div class="modal-buttons">\n                <button class="close-btn" onclick="this.closest('.modal').remove()">Close</button>\n            </div>\n        </div>\n    `;
    
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

// ===== LOAD EXTERNAL LIBRARY =====
async function loadJSZipLibrary() {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load JSZip library'));
        document.head.appendChild(script);
    });
}

// ===== START APPLICATION =====
document.addEventListener('DOMContentLoaded', init);