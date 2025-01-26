chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "processCSV") {
        processChannels(request.data).then(() => {
            sendResponse({ success: true }); // 处理完成
        }).catch(error => {
            console.error('Error processing channels:', error);
            sendResponse({ success: false, error: error.message });
        });
        return true; // 保持消息通道开启
    }
    if (request.action === "processAllPlaylists") {
        processAllPlaylists(request.playlists).then(() => {
            sendResponse({ success: true });
        }).catch(error => {
            console.error('Error processing playlists:', error);
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }
});

// 处理频道的函数
async function processChannels(data) {
    const channels = CSVToArray(data);
    console.log('All channels turned to array');
    
    for (let i = 1; i < channels.length; i++) {
        const channelUrl = channels[i][1];
        const channelTitle = channels[i][2];
        console.log(`Processing channel ${i}/${channels.length - 1}: ${channelTitle}`);

        // 在同一个标签页中打开频道 URL
        await new Promise(resolve => {
            chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
                const currentTab = tabs[0];
                // 更新当前活动标签页的 URL
                chrome.tabs.update(currentTab.id, { url: channelUrl }, function() {
                    // 等待标签页加载完成
                    chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
                        if (tabId === currentTab.id && changeInfo.status === 'complete') {
                            // 发送消息到当前标签页
                            chrome.tabs.sendMessage(currentTab.id, { action: "subscribeToChannel", channelUrl, channelTitle }, (response) => {
                                if (response && response.status === "success") {
                                    console.log(`Successfully subscribed to ${channelTitle}`);
                                } else if (response && response.status === "error") {
                                    console.error(`Failed to subscribe to ${channelTitle}: ${response.error}`);
                                }
                                // 解除事件监听器
                                chrome.tabs.onUpdated.removeListener(listener);
                                resolve(); // 处理完成，继续下一个频道
                            });
                        }
                    });
                });
            });
        });
    }
    console.log('All channels processed');
}

// CSV解析函数
function CSVToArray(strData, strDelimiter) {
    strDelimiter = (strDelimiter || ",");
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
        let strMatchedValue;
        if (arrMatches[2]) {
            strMatchedValue = arrMatches[2].replace(
                new RegExp("\"\"", "g"),
                "\""
            );
        } else {
            strMatchedValue = arrMatches[3];
        }
        arrData[arrData.length - 1].push(strMatchedValue);
    }
    return arrData;
}

async function processAllPlaylists(playlists) {
    console.log(`开始处理 ${playlists.length} 个播放列表`);
    
    return new Promise((resolve, reject) => {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            const currentTab = tabs[0];
            let currentPlaylistIndex = 0;
            let currentVideoIndex = 0;
            let retryCount = 0;
            const MAX_RETRIES = 3;
            
            async function processNextVideo() {
                try {
                    // 检查是否所有播放列表都处理完成
                    if (currentPlaylistIndex >= playlists.length) {
                        console.log('所有播放列表处理完成');
                        resolve();
                        return;
                    }
                    
                    const currentPlaylist = playlists[currentPlaylistIndex];
                    const videos = currentPlaylist.videos;
                    
                    // 检查当前播放列表是否处理完成
                    if (currentVideoIndex >= videos.length) {
                        console.log(`播放列表 ${currentPlaylist.name} 处理完成`);
                        currentPlaylistIndex++;
                        currentVideoIndex = 0;
                        setTimeout(processNextVideo, 2000);
                        return;
                    }
                    
                    const videoId = videos[currentVideoIndex];
                    console.log(`处理播放列表 ${currentPlaylist.name} 的第 ${currentVideoIndex + 1}/${videos.length} 个视频: ${videoId}`);
                    
                    // 处理单个视频的逻辑
                    await new Promise((resolveVideo) => {
                        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
                        chrome.tabs.update(currentTab.id, { url: videoUrl }, function() {
                            function onTabUpdated(tabId, changeInfo) {
                                if (tabId === currentTab.id && changeInfo.status === 'complete') {
                                    chrome.tabs.onUpdated.removeListener(onTabUpdated);
                                    setTimeout(() => {
                                        chrome.tabs.sendMessage(currentTab.id, {
                                            action: "createPlaylist",
                                            name: currentPlaylist.name,
                                            currentVideo: videoId
                                        }, (response) => {
                                            if (chrome.runtime.lastError) {
                                                retryCount++;
                                                if (retryCount < MAX_RETRIES) {
                                                    setTimeout(processNextVideo, 2000);
                                                } else {
                                                    reject(new Error(`处理视频 ${videoId} 失败`));
                                                }
                                                return;
                                            }
                                            
                                            if (response && response.status === "continue") {
                                                currentVideoIndex++;
                                                retryCount = 0;
                                                setTimeout(processNextVideo, 2000);
                                            } else {
                                                reject(new Error(`处理视频 ${videoId} 失败`));
                                            }
                                            resolveVideo();
                                        });
                                    }, 2000);
                                }
                            }
                            chrome.tabs.onUpdated.addListener(onTabUpdated);
                        });
                    });
                    
                } catch (error) {
                    console.error('处理视频时发生错误:', error);
                    retryCount++;
                    if (retryCount < MAX_RETRIES) {
                        setTimeout(processNextVideo, 2000);
                    } else {
                        reject(error);
                    }
                }
            }
            
            // 开始处理第一个视频
            processNextVideo().catch(reject);
        });
    });
}

// 处理来自 popup 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "processPlaylist") {
        processPlaylist(request.name, request.data, request.isLastFile).then(() => {
            sendResponse({ success: true });
        }).catch(error => {
            console.error('Error processing playlist:', error);
            sendResponse({ success: false, error: error.message });
        });
        return true;
    } else if (request.action === "keepAlive") {
        sendResponse({ status: "alive" });
        return true;
    }
});