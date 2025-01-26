let observer;

chrome.runtime.onMessage.addListener((request, _, sendResponse) => {
    if (request.action === "subscribeToChannel") {
        (async () => {
            try {
                await subscribeToChannel(request.channelUrl, request.channelTitle);
                sendResponse({ status: "success" });
            } catch (error) {
                console.error(`订阅失败: ${error}`);
                sendResponse({ status: "error", error: error.message });
            }
        })();
        return true; // Indicates that async response will be sent
    }
    if (request.action === "createPlaylist") {
        (async () => {
            try {
                // 先处理当前页面的视频
                await addVideoToPlaylist(request.currentVideo, request.name);
                console.log('该视频处理完成，发送消息继续处理下一个视频');
                
                // 通知后台脚本继续处理下一个视频
                sendResponse({ 
                    status: "continue", 
                    processedVideo: request.currentVideo 
                });
            } catch (error) {
                console.error('处理播放列表失败:', error);
                sendResponse({ status: "error", error: error.message });
            }
        })();
        return true;
    }
});

// 等待页面加载某个元素，添加重试机制
const waitForElement = (selector, timeout = 5000, parent = document) => {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        
        const checkElement = () => {
            const element = parent.querySelector(selector);
            if (element) {
                resolve(element);
            } else if (Date.now() - startTime > timeout) {
                reject(new Error(`元素 ${selector} 在 ${timeout}ms 内未找到`));
            } else {
                setTimeout(checkElement, 100);
            }
        };
        checkElement();
    });
};

// 订阅频道
const subscribeToChannel = async (channelUrl, channelTitle) => {
    console.log(`尝试订阅频道: ${channelTitle} (${channelUrl})`);

    try {
        // 等待页面加载完成
        await waitForElement('body'); // 等待页面主体加载

        // 等待订阅按钮出现
        const subscribeButton = await waitForElement('button[aria-label^="订阅"], button[aria-label^="Subscribe"]');
        console.log('找到订阅按钮:', subscribeButton);

        // 检查按钮状态
        const buttonText = subscribeButton.textContent.trim().toLowerCase();
        if (buttonText.includes('订阅') || buttonText.includes('subscribe')) {
            // 创建鼠标点击事件
            const event = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window
            });
            subscribeButton.dispatchEvent(event);
            console.log('已点击订阅按钮');
        } else {
            console.log('频道已经被订阅，无需操作');
        }
    } catch (error) {
        console.error('订阅过程中发生错误:', error);
        throw error; // 将错误抛出以便于上层捕获
    }
};


// 等待页面完全加载
const waitForPageLoad = async () => {
    // 等待页面基本加载完成
    if (document.readyState !== 'complete') {
        await new Promise(resolve => {
            window.addEventListener('load', resolve, { once: true });
        });
    }
    // 额外等待一段时间确保 YouTube 的动态内容加载完成
    await new Promise(r => setTimeout(r, 2000));
};


async function isVideoAvailable() {
    try {
        const videoId = new URL(window.location.href).searchParams.get('v');
        if (!videoId) return false;
        
        const response = await fetch(`https://img.youtube.com/vi/${videoId}/default.jpg`);
        if (!response.ok) {
            console.log(`视频 ${videoId} 的缩略图不存在，视频可能已失效`);
            return false;
        }
        
        return true;
    } catch (error) {
        console.log(`检查视频缩略图失败:`, error);
        return false;
    }
}

async function addVideoToPlaylist(videoId, playlistName) {
    try {
        // 确保页面完全加载
        await waitForPageLoad();
        
        // 等待更长时间以确保错误信息和视频信息完全加载
        await new Promise(r => setTimeout(r, 3000));
        
        // 检查视频是否可用
        if (!await isVideoAvailable()) {
            console.log(`视频 ${videoId} 不可用，跳过处理`);
            return { status: "continue", skipped: true };
        }
        
        // 点击保存按钮，添加重试机制
        let saveButton;
        for (let retryCount = 0; retryCount < 3; retryCount++) {
            try {
                saveButton = await waitForElement('button[aria-label^="保存"], button[aria-label^="Save"]', 3000);
                if (!saveButton) {
                    console.log(`未找到保存按钮，视频可能不可用`);
                    return { status: "continue", skipped: true };
                }
                await new Promise(r => setTimeout(r, 500));
                saveButton.click();
                break;
            } catch (error) {
                console.log(`第 ${retryCount + 1} 次尝试点击保存按钮失败，等待重试...`);
                // 最后一次重试失败，检查视频是否真的不可用
                if (retryCount === 2) {
                    if (!await isVideoAvailable()) {
                        console.log(`视频 ${videoId} 不可用，跳过处理`);
                        return { status: "continue", skipped: true };
                    }
                    throw error;
                }
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        
        // 等待播放列表菜单出现
        let playlistsContainer;
        for (let retryCount = 0; retryCount < 3; retryCount++) {
            try {
                playlistsContainer = await waitForElement('#playlists');
                break;
            } catch (error) {
                console.log(`第 ${retryCount + 1} 次尝试获取播放列表容器失败，重试中...`);
                // 重新点击保存按钮
                saveButton.click();
                await new Promise(r => setTimeout(r, 1500));
                if (retryCount === 2) throw error;
            }
        }
        
        try {
            // 等待播放列表选项加载完成
            await new Promise(r => setTimeout(r, 1000));
            
            // 查找目标播放列表
            const allOptions = playlistsContainer.querySelectorAll('ytd-playlist-add-to-option-renderer');
            let targetOption = null;
            
            for (const option of allOptions) {
                const titleElement = option.querySelector('yt-formatted-string[id="label"]');
                if (titleElement && titleElement.getAttribute('title') === playlistName) {
                    targetOption = option;
                    break;
                }
            }
            
            if (targetOption) {
                const checkbox = targetOption.querySelector('tp-yt-paper-checkbox');
                const isChecked = checkbox.getAttribute('aria-checked') === 'true';
                
                if (!isChecked) {
                    console.log(`将视频添加到播放列表 ${playlistName}`);
                    checkbox.click();
                    await new Promise(r => setTimeout(r, 500));
                } else {
                    console.log(`视频已在播放列表 ${playlistName} 中，跳过`);
                }
            } else {
                console.log(`播放列表 ${playlistName} 不存在，创建新的...`);
                const createNewButton = await waitForElement('button[aria-label^="新建播放列表"], button[aria-label^="New playlist"]');
                createNewButton.click();
                await new Promise(r => setTimeout(r, 1000));
                
                const nameInput = await waitForElement('textarea.ytStandardsTextareaShapeTextarea');
                nameInput.value = playlistName;
                nameInput.dispatchEvent(new Event('input', { bubbles: true }));
                await new Promise(r => setTimeout(r, 500));
                
                const createButton = await waitForElement('.yt-spec-button-shape-next--filled[aria-label^="创建"], .yt-spec-button-shape-next--filled[aria-label^="Create"]');
                createButton.click();
            }
        } catch (error) {
            console.error('处理播放列表选项失败:', error);
            throw error;
        }
        
        // 等待操作完成
        await new Promise(r => setTimeout(r, 1500));
        console.log(`视频 ${videoId} 已处理完成`);
        return true;
        
    } catch (error) {
        console.error(`添加视频 ${videoId} 失败:`, error);
        throw error;
    }
}
