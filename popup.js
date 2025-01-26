// 在文件开头添加
function updateFileInputLabel(input, defaultText) {
    const wrapper = input.parentElement;
    const label = wrapper.querySelector('.custom-file-input');
    
    input.addEventListener('change', (event) => {
        const fileInput = document.getElementById('fileInput');
        const playlistFolderInput = document.getElementById('playlistFolderInput');
    
        updateFileInputLabel(fileInput, 'Choose CSV file');
        updateFileInputLabel(playlistFolderInput, 'Choose folder');

        if (input.hasAttribute('webkitdirectory')) {
            const files = Array.from(event.target.files).filter(file => file.name.endsWith('-videos.csv'));
            label.textContent = files.length > 0 ? `${files.length} playlist files selected` : defaultText;
        } else {
            label.textContent = event.target.files[0]?.name || defaultText;
        }
    });
}

// 添加进度条更新函数
function updateProgress(type, progress) {
    const section = document.querySelector(`.${type}`);
    const progressBar = section.querySelector('.progress-bar');
    const progressContainer = section.querySelector('.progress');
    
    progressContainer.style.display = 'block';
    progressBar.style.width = `${progress}%`;
}

// 添加状态更新函数
function updateStatus(type, message) {
    const statusElement = document.getElementById(`${type}Status`);
    statusElement.textContent = message;
}


document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.addEventListener('change', handleFile);
    }

    // 新增的播放列表导入功能
    const playlistFolderInput = document.getElementById('playlistFolderInput');
    if (playlistFolderInput) {
        playlistFolderInput.addEventListener('change', handlePlaylistFolder);
    }

    if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
    }
});

function handleFile(event) {
    const file = event.target.files[0]; // 获取用户选择的文件
    const messageDiv = document.getElementById('message');
    const errorMessageDiv = document.getElementById('errorMessage');

    // 清空之前的消息
    messageDiv.textContent = '';
    errorMessageDiv.textContent = '';

    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            const csvData = e.target.result;

            // 发送消息到后台脚本
            chrome.runtime.sendMessage({ action: "processCSV", data: csvData }, (response) => {
                if (chrome.runtime.lastError) {
                    errorMessageDiv.textContent = 'Error: ' + chrome.runtime.lastError.message;
                } else {
                    if (response.success) {
                        messageDiv.textContent = 'CSV processed successfully';
                    } else {
                        errorMessageDiv.textContent = 'Process error: ' + response.error;
                    }
                }
            });
        };

        reader.onerror = function () {
            errorMessageDiv.textContent = 'File read failed';
        };

        reader.readAsText(file); // 读取文件
    } else {
        errorMessageDiv.textContent = 'Please choose a file'; // 提示用户选择文件
    }
}

async function handlePlaylistFolder(event) {
    const files = Array.from(event.target.files).filter(file => file.name.endsWith('-videos.csv'));
    const messageDiv = document.getElementById('playlistMessage');
    const errorDiv = document.getElementById('playlistError');
    
    messageDiv.textContent = '';
    errorDiv.textContent = '';
    
    console.log(`找到 ${files.length} 个播放列表文件`);
    messageDiv.textContent = `开始处理 ${files.length} 个播放列表...`;
    
    try {
        // 合并所有 CSV 文件的数据
        const allPlaylists = [];
        for (const file of files) {
            const csvData = await readFileAsync(file);
            const playlistName = file.name.replace('-videos.csv', '');
            const videos = CSVToArray(csvData).slice(1); // 跳过标题行
            allPlaylists.push({
                name: playlistName,
                videos: videos.map(row => row[0]).filter(id => id) // 只取视频ID
            });
        }
        
        // 发送合并后的数据到后台处理
        await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                action: "processAllPlaylists",
                playlists: allPlaylists
            }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else if (response.success) {
                    messageDiv.textContent = '所有播放列表处理完成';
                    resolve();
                } else {
                    reject(new Error(response.error));
                }
            });
        });
        
    } catch (error) {
        console.error('处理播放列表失败:', error);
        errorDiv.textContent = `处理失败: ${error.message}`;
    }
}

// 添加 CSV 解析函数
function CSVToArray(strData, strDelimiter = ",") {
    const objPattern = new RegExp(
        ("(\\" + strDelimiter + "|\\r?\\n|\\r|^)" +
            "(?:\"([^\"]*(?:\"\"[^\"]*)*)\"|" +
            "([^\"\\" + strDelimiter + "\\r\\n]*))"),
        "gi"
    );
    const arrData = [[]];
    let arrMatches = null;
    while (arrMatches = objPattern.exec(strData)) {
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

// 保持 popup 页面活跃
let keepAliveInterval;
document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.addEventListener('change', handleFile);
    }

    const playlistFolderInput = document.getElementById('playlistFolderInput');
    if (playlistFolderInput) {
        playlistFolderInput.addEventListener('change', handlePlaylistFolder);
    }
    
    // 每隔一段时间执行一些操作，保持 popup 活跃
    keepAliveInterval = setInterval(() => {
        chrome.runtime.sendMessage({ action: "keepAlive" });
    }, 25000);
});


// 辅助函数：将 FileReader 包装为 Promise
function readFileAsync(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
    });
}

// 监听来自后台脚本的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "updateStatus") {
        const messageDiv = document.getElementById('message');
        messageDiv.textContent = request.message;  // 使用 textContent
    }
});