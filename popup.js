// 修改 updateFileInputLabel 函数
function updateFileInputLabel(input, defaultText) {
    const wrapper = input.parentElement;
    const label = wrapper.querySelector('.custom-file-input');

    input.addEventListener('change', (event) => {
        if (input.hasAttribute('webkitdirectory')) {
            const files = Array.from(event.target.files || []).filter(file => file.name.endsWith('-videos.csv'));
            label.textContent = files.length > 0 ? `${files.length} playlist files selected` : defaultText;
        } else {
            label.textContent = event.target.files[0]?.name || defaultText;
        }
    });
}

// 处理文件上传
async function handleFile(event) {
    const file = event.target.files[0];
    const messageDiv = document.getElementById('message');
    const errorMessageDiv = document.getElementById('errorMessage');

    messageDiv.textContent = '';
    errorMessageDiv.textContent = '';
    errorMessageDiv.style.display = 'none';

    if (file) {
        try {
            const csvData = await readFileAsync(file);
            // 发送消息并等待初始响应
            chrome.runtime.sendMessage({ 
                action: "processCSV", 
                data: csvData 
            });
            
            // 显示处理中的状态
            messageDiv.textContent = 'Processing...';
            messageDiv.className = 'message';
            
        } catch (error) {
            errorMessageDiv.textContent = 'File read failed: ' + error.message;
            errorMessageDiv.style.display = 'block';
        }
    }
}

// 处理播放列表文件夹
async function handlePlaylistFolder(event) {
    const files = Array.from(event.target.files || []).filter(file => file.name.endsWith('-videos.csv'));
    const messageDiv = document.getElementById('playlistMessage');
    const errorDiv = document.getElementById('playlistError');

    messageDiv.textContent = '';
    errorDiv.textContent = '';
    errorDiv.style.display = 'none';

    if (!files || files.length === 0) {
        return;
    }

    try {
        const allPlaylists = [];
        for (const file of files) {
            const csvData = await readFileAsync(file);
            const playlistName = file.name.replace('-videos.csv', '');
            const videos = CSVToArray(csvData).slice(1);
            allPlaylists.push({
                name: playlistName,
                videos: videos.map(row => row[0]).filter(id => id)
            });
        }

        chrome.runtime.sendMessage({
            action: "processAllPlaylists",
            playlists: allPlaylists
        }, (response) => {
            if (chrome.runtime.lastError) {
                errorDiv.textContent = 'Error: ' + chrome.runtime.lastError.message;
                errorDiv.style.display = 'block';
            } else if (response.success) {
                messageDiv.textContent = '所有播放列表处理完成';
                messageDiv.className = 'message success';
            } else {
                errorDiv.textContent = 'Process error: ' + response.error;
                errorDiv.style.display = 'block';
            }
        });
    } catch (error) {
        console.error('处理播放列表失败:', error);
        errorDiv.textContent = `处理失败: ${error.message}`;
        errorDiv.style.display = 'block';
    }
}

// 辅助函数：将 FileReader 包装为 Promise
function readFileAsync(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
    });
}

// CSV 解析函数
function CSVToArray(strData, strDelimiter = ",") {
    const objPattern = new RegExp(
        ("(\\" + strDelimiter + "|\\r?\\n|\\r|^)" +
            "(?:\"([^\"]*(?:\"\"[^\"]*)*)\"|" +
            "([^\"\\" + strDelimiter + "\\r\\n]*))"),
        "gi"
    );
    const arrData = [[]];
    let arrMatches = null;
    while ((arrMatches = objPattern.exec(strData))) {
        const strMatchedDelimiter = arrMatches[1];
        if (strMatchedDelimiter.length && strMatchedDelimiter !== strDelimiter) {
            arrData.push([]);
        }
        let strMatchedValue = arrMatches[2] ?
            arrMatches[2].replace(new RegExp("\"\"", "g"), "\"") :
            arrMatches[3];
        arrData[arrData.length - 1].push(strMatchedValue);
    }
    return arrData;
}

// 初始化
let keepAliveInterval;
document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('fileInput');
    const playlistFolderInput = document.getElementById('playlistFolderInput');

    if (fileInput) {
        updateFileInputLabel(fileInput, 'Choose CSV file');
        fileInput.addEventListener('change', handleFile);
    }

    if (playlistFolderInput) {
        updateFileInputLabel(playlistFolderInput, 'Choose folder');
        playlistFolderInput.addEventListener('change', handlePlaylistFolder);
    }

    // 保持 popup 活跃
    keepAliveInterval = setInterval(() => {
        chrome.runtime.sendMessage({ action: "keepAlive" });
    }, 25000);
});

// 在 popup 关闭时清除定时器
window.addEventListener('unload', () => {
    if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
    }
});

// 监听来自后台脚本的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "processComplete") {
        const messageDiv = document.getElementById('message');
        const errorMessageDiv = document.getElementById('errorMessage');
        
        if (request.success) {
            messageDiv.textContent = 'Process completed successfully';
            messageDiv.className = 'message success';
        } else {
            errorMessageDiv.textContent = 'Process error: ' + request.error;
            errorMessageDiv.style.display = 'block';
        }
    }
    if (request.action === "updateProgress") {
        const progressBar = document.querySelector(`.${request.type} .progress-bar`);
        const progressContainer = document.querySelector(`.${request.type} .progress`);
        if (progressBar && progressContainer) {
            progressContainer.style.display = 'block';
            progressBar.style.width = `${request.progress}%`;
        }
    } else if (request.action === "playlistsCompleted") {
        // 显示完成消息
        const messageDiv = document.getElementById('playlistMessage');
        if (messageDiv) {
            messageDiv.textContent = request.message;
            messageDiv.className = 'message success';
        }
        
        // 隐藏进度条
        const progressContainer = document.querySelector('.playlists .progress');
        if (progressContainer) {
            progressContainer.style.display = 'none';
        }
        
    } else if (request.action === "playlistsError") {
        // 显示错误消息
        const errorDiv = document.getElementById('playlistError');
        if (errorDiv) {
            errorDiv.textContent = `Processing failed: ${request.error}`;
            errorDiv.style.display = 'block';
        }
        
        // 错误时也使用通知
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icon48.png',
            title: 'Failed to process playlists',
            message: `Processing failed: ${request.error}`
        });
    }
});