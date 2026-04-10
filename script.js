// ==================== XSphere - المتغيرات العامة ====================
let currentUser = null;
let currentPostId = null;
let currentChatUser = null;
let currentProfileUser = null;
let selectedMediaFile = null;
let currentTweetId = null;
let typingTimeout = null;
let currentReportPostId = null;
let selectedReportReason = null;
let readModeActive = false;
let hideLikesActive = false;

// ==================== Voice Recording Variables ====================
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

// ==================== Infinite Scroll Variables ====================
let allTweetsCache = [];
let currentDisplayCount = 0;
let isLoadingMore = false;
let hasMoreTweets = true;
let scrollListenerActive = true;
const TWEETS_PER_BATCH = 8;

// ==================== Agora Variables ====================
let agoraClient = null;
let localTracks = { videoTrack: null, audioTrack: null };
let isCallActive = false;

// ==================== Bad Words ====================
let badWordsList = [];

// ==================== Helper Functions ====================
function showToast(message, duration = 2000) {
    const toast = document.getElementById('customToast');
    if (!toast) return;
    toast.textContent = message;
    toast.style.opacity = '1';
    setTimeout(() => { toast.style.opacity = '0'; }, duration);
}

function formatTime(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days} يوم`;
    if (hours > 0) return `${hours} ساعة`;
    if (minutes > 0) return `${minutes} دقيقة`;
    return `${seconds} ثانية`;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function extractHashtags(text) {
    const hashtags = text.match(/#[\w\u0600-\u06FF]+/g) || [];
    return hashtags.map(tag => tag.substring(1));
}

function containsBadWords(text) {
    if (!text || badWordsList.length === 0) return false;
    const lowerText = text.toLowerCase();
    for (const word of badWordsList) {
        if (lowerText.includes(word.toLowerCase())) return true;
    }
    return false;
}

function filterBadWords(text) {
    if (!text || badWordsList.length === 0) return text;
    let filtered = text;
    for (const word of badWordsList) {
        const regex = new RegExp(word, 'gi');
        filtered = filtered.replace(regex, '*'.repeat(word.length));
    }
    return filtered;
}

// ==================== Media Viewer (صور وفيديو) ====================
function openMediaViewer(url, type) {
    const modal = document.getElementById('mediaViewerModal');
    const viewerImage = document.getElementById('viewerImage');
    const viewerVideo = document.getElementById('viewerVideo');
    
    if (type === 'image') {
        viewerImage.style.display = 'block';
        viewerVideo.style.display = 'none';
        viewerImage.src = url;
        viewerVideo.pause();
    } else if (type === 'video') {
        viewerImage.style.display = 'none';
        viewerVideo.style.display = 'block';
        viewerVideo.src = url;
        viewerVideo.load();
        viewerVideo.play();
    }
    
    modal.classList.add('open');
}

function closeMediaViewer() {
    const modal = document.getElementById('mediaViewerModal');
    const viewerVideo = document.getElementById('viewerVideo');
    viewerVideo.pause();
    modal.classList.remove('open');
}

// ==================== Upload to Cloudinary ====================
async function uploadToCloudinary(file, onProgress) {
    const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/upload`;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', UPLOAD_PRESET);
    
    try {
        const response = await fetch(url, { method: 'POST', body: formData });
        const data = await response.json();
        if (data.secure_url) return data.secure_url;
        throw new Error('Upload failed');
    } catch (error) {
        console.error('Cloudinary error:', error);
        showToast('فشل رفع الملف');
        return null;
    }
}

// ==================== Voice Recording ====================
async function startVoiceRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        
        mediaRecorder.ondataavailable = (event) => { audioChunks.push(event.data); };
        
        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const audioUrl = await uploadToCloudinary(audioBlob);
            
            if (audioUrl && currentChatUser) {
                const chatId = getChatId(currentUser.uid, currentChatUser.uid);
                await db.ref(`chats/${chatId}`).push({
                    senderId: currentUser.uid,
                    audioUrl: audioUrl,
                    timestamp: Date.now(),
                    read: false
                });
                showToast('🎤 تم إرسال الرسالة الصوتية');
                loadChatMessages(currentChatUser.uid);
            }
            
            stream.getTracks().forEach(track => track.stop());
            document.getElementById('recordingIndicator').classList.remove('active');
        };
        
        mediaRecorder.start();
        isRecording = true;
        document.getElementById('recordingIndicator').classList.add('active');
        showToast('🔴 جاري التسجيل... اضغط مرة أخرى للإيقاف');
    } catch (error) {
        console.error('Recording error:', error);
        showToast('❌ لا يمكن الوصول إلى الميكروفون');
    }
}

function stopVoiceRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
    }
}

function toggleVoiceRecording() {
    if (isRecording) { stopVoiceRecording(); } else { startVoiceRecording(); }
}

// ==================== Upload Avatar ====================
async function uploadAvatar(input) {
    const file = input.files[0];
    if (!file) return;
    
    showToast('🔄 جاري رفع الصورة...');
    const url = await uploadToCloudinary(file);
    if (url) {
        await db.ref(`users/${currentUser.uid}`).update({ avatar: url });
        currentUser.avatar = url;
        
        const avatarDiv = document.getElementById('currentUserAvatar');
        if (avatarDiv) avatarDiv.innerHTML = `<img src="${url}">`;
        
        const editAvatarDiv = document.getElementById('editAvatar');
        if (editAvatarDiv) editAvatarDiv.innerHTML = `<img src="${url}"><div class="avatar-overlay"><i class="fa-solid fa-camera"></i></div>`;
        
        showToast('✅ تم تغيير الصورة الشخصية بنجاح');
        if (currentProfileUser === currentUser.uid) { openProfile(currentUser.uid); }
    }
}

// ==================== Tweet Media Handling ====================
let tweetMediaFile = null;

function handleTweetMedia(input, type) {
    const file = input.files[0];
    if (file) {
        tweetMediaFile = file;
        const previewDiv = document.getElementById('mediaPreview');
        const reader = new FileReader();
        reader.onload = function(e) {
            if (type === 'image') {
                previewDiv.innerHTML = `<div class="preview-container"><img src="${e.target.result}"><div class="remove-media" onclick="removeTweetMedia()"><i class="fa-solid fa-xmark"></i></div></div>`;
            } else if (type === 'video') {
                previewDiv.innerHTML = `<div class="preview-container"><video src="${e.target.result}" controls></video><div class="remove-media" onclick="removeTweetMedia()"><i class="fa-solid fa-xmark"></i></div></div>`;
            }
            previewDiv.classList.add('active');
        };
        reader.readAsDataURL(file);
    }
}

function handleComposeMedia(input, type) {
    const file = input.files[0];
    if (file) {
        tweetMediaFile = file;
        const previewDiv = document.getElementById('composeMediaPreview');
        const reader = new FileReader();
        reader.onload = function(e) {
            if (type === 'image') {
                previewDiv.innerHTML = `<div class="preview-container"><img src="${e.target.result}"><div class="remove-media" onclick="removeComposeMedia()"><i class="fa-solid fa-xmark"></i></div></div>`;
            } else if (type === 'video') {
                previewDiv.innerHTML = `<div class="preview-container"><video src="${e.target.result}" controls></video><div class="remove-media" onclick="removeComposeMedia()"><i class="fa-solid fa-xmark"></i></div></div>`;
            }
            previewDiv.classList.add('active');
        };
        reader.readAsDataURL(file);
    }
}

function removeTweetMedia() {
    tweetMediaFile = null;
    const previewDiv = document.getElementById('mediaPreview');
    previewDiv.innerHTML = '';
    previewDiv.classList.remove('active');
    document.getElementById('tweetImage').value = '';
    document.getElementById('tweetVideo').value = '';
}

function removeComposeMedia() {
    tweetMediaFile = null;
    const previewDiv = document.getElementById('composeMediaPreview');
    previewDiv.innerHTML = '';
    previewDiv.classList.remove('active');
    document.getElementById('composeImage').value = '';
    document.getElementById('composeVideo').value = '';
}

// ==================== Create Tweet ====================
async function createTweet() {
    let text = document.getElementById('tweetText')?.value;
    if (!text && !tweetMediaFile) return showToast('⚠️ الرجاء كتابة نص أو إضافة وسائط');
    if (containsBadWords(text)) return showToast('⚠️ التغريدة تحتوي على كلمات ممنوعة');
    text = filterBadWords(text);
    
    let mediaUrl = "", mediaType = "";
    if (tweetMediaFile) {
        mediaType = tweetMediaFile.type.split('/')[0];
        mediaUrl = await uploadToCloudinary(tweetMediaFile);
        if (!mediaUrl) return;
    }
    
    const hashtags = extractHashtags(text);
    const tweetRef = db.ref('tweets').push();
    
    await tweetRef.set({
        id: tweetRef.key,
        userId: currentUser.uid,
        userName: currentUser.displayName || currentUser.name,
        userAvatar: currentUser.avatar || "",
        text: text,
        mediaUrl: mediaUrl,
        mediaType: mediaType,
        hashtags: hashtags,
        likes: {},
        retweets: {},
        commentsCount: 0,
        views: 0,
        timestamp: Date.now()
    });
    
    for (const tag of hashtags) { await db.ref(`hashtags/${tag.toLowerCase()}/${tweetRef.key}`).set(true); }
    
    document.getElementById('tweetText').value = "";
    removeTweetMedia();
    await refreshFeedCache();
    loadTrendingHashtags();
    showToast('✅ تم نشر التغريدة بنجاح!');
}

async function submitComposeTweet() {
    let text = document.getElementById('composeText')?.value;
    if (!text && !tweetMediaFile) return showToast('⚠️ الرجاء كتابة نص أو إضافة وسائط');
    if (containsBadWords(text)) return showToast('⚠️ التغريدة تحتوي على كلمات ممنوعة');
    text = filterBadWords(text);
    
    let mediaUrl = "", mediaType = "";
    if (tweetMediaFile) {
        mediaType = tweetMediaFile.type.split('/')[0];
        mediaUrl = await uploadToCloudinary(tweetMediaFile);
        if (!mediaUrl) return;
    }
    
    const hashtags = extractHashtags(text);
    const tweetRef = db.ref('tweets').push();
    
    await tweetRef.set({
        id: tweetRef.key,
        userId: currentUser.uid,
        userName: currentUser.displayName || currentUser.name,
        userAvatar: currentUser.avatar || "",
        text: text,
        mediaUrl: mediaUrl,
        mediaType: mediaType,
        hashtags: hashtags,
        likes: {},
        retweets: {},
        commentsCount: 0,
        views: 0,
        timestamp: Date.now()
    });
    
    for (const tag of hashtags) { await db.ref(`hashtags/${tag.toLowerCase()}/${tweetRef.key}`).set(true); }
    
    document.getElementById('composeText').value = "";
    removeComposeMedia();
    closeCompose();
    await refreshFeedCache();
    loadTrendingHashtags();
    showToast('✅ تم نشر التغريدة بنجاح!');
}

// ==================== Delete Tweet ====================
async function deleteTweet(tweetId) {
    if (!confirm('⚠️ هل أنت متأكد من حذف هذه التغريدة؟')) return;
    const tweetSnapshot = await db.ref(`tweets/${tweetId}`).once('value');
    const tweet = tweetSnapshot.val();
    if (tweet.userId !== currentUser.uid && !currentUser.isAdmin) return showToast('❌ لا يمكنك حذف تغريدة ليست لك');
    if (tweet.hashtags) {
        for (const tag of tweet.hashtags) { await db.ref(`hashtags/${tag.toLowerCase()}/${tweetId}`).remove(); }
    }
    await db.ref(`tweets/${tweetId}`).remove();
    await refreshFeedCache();
    loadTrendingHashtags();
    showToast('🗑️ تم حذف التغريدة');
}

// ==================== Like Tweet ====================
async function likeTweet(tweetId) {
    const likeRef = db.ref(`tweets/${tweetId}/likes/${currentUser.uid}`);
    const snapshot = await likeRef.once('value');
    const wasLiked = snapshot.exists();
    
    if (wasLiked) {
        await likeRef.remove();
    } else {
        await likeRef.set(true);
        const tweetSnapshot = await db.ref(`tweets/${tweetId}`).once('value');
        const tweet = tweetSnapshot.val();
        if (tweet && tweet.userId !== currentUser.uid) {
            await db.ref(`notifications/${tweet.userId}`).push({
                type: 'like', userId: currentUser.uid, userName: currentUser.displayName || currentUser.name,
                tweetId: tweetId, timestamp: Date.now(), read: false
            });
        }
    }
    refreshFeedCache();
}

// ==================== Retweet ====================
async function retweet(tweetId) {
    const retweetRef = db.ref(`tweets/${tweetId}/retweets/${currentUser.uid}`);
    const snapshot = await retweetRef.once('value');
    const wasRetweeted = snapshot.exists();
    
    if (wasRetweeted) {
        await retweetRef.remove();
        showToast('↩️ تم إلغاء إعادة التغريد');
    } else {
        await retweetRef.set(true);
        showToast('🔄 تم إعادة التغريد');
        const tweetSnapshot = await db.ref(`tweets/${tweetId}`).once('value');
        const tweet = tweetSnapshot.val();
        if (tweet && tweet.userId !== currentUser.uid) {
            await db.ref(`notifications/${tweet.userId}`).push({
                type: 'retweet', userId: currentUser.uid, userName: currentUser.displayName || currentUser.name,
                tweetId: tweetId, timestamp: Date.now(), read: false
            });
        }
    }
    refreshFeedCache();
}

// ==================== Comments ====================
async function openComments(tweetId) {
    currentTweetId = tweetId;
    document.getElementById('commentsModal').classList.add('open');
    await loadComments(tweetId);
}

function closeCommentsModal() {
    document.getElementById('commentsModal').classList.remove('open');
    currentTweetId = null;
}

async function loadComments(tweetId) {
    const snapshot = await db.ref(`comments/${tweetId}`).once('value');
    const comments = snapshot.val();
    const container = document.getElementById('commentsList');
    if (!comments) {
        container.innerHTML = '<div style="text-align: center; padding: 20px; color: #536471;">لا توجد تعليقات بعد</div>';
        return;
    }
    let html = '';
    const commentsArray = Object.values(comments).sort((a, b) => b.timestamp - a.timestamp);
    for (const comment of commentsArray) {
        const userSnapshot = await db.ref(`users/${comment.userId}`).once('value');
        const userData = userSnapshot.val();
        const isVerified = userData?.verified || false;
        html += `
            <div style="display: flex; gap: 12px; padding: 12px 0; border-bottom: 1px solid #EFF3F4;">
                <div class="post-avatar" style="width: 40px; height: 40px;" onclick="openProfile('${comment.userId}')">
                    ${comment.userAvatar ? `<img src="${comment.userAvatar}">` : '<i class="fa-solid fa-user text-white"></i>'}
                </div>
                <div style="flex: 1;">
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <span class="post-name" onclick="openProfile('${comment.userId}')" style="cursor: pointer;">${escapeHtml(comment.userName)}</span>
                        ${isVerified ? '<i class="fa-solid fa-circle-check verified-badge" style="font-size: 14px;"></i>' : ''}
                        <span style="color: #536471; font-size: 12px;">${formatTime(comment.timestamp)}</span>
                    </div>
                    <div style="margin-top: 4px;">${escapeHtml(comment.text)}</div>
                </div>
            </div>
        `;
    }
    container.innerHTML = html;
}

async function addComment() {
    let text = document.getElementById('commentInput')?.value;
    if (!text || !currentTweetId) return;
    if (containsBadWords(text)) return showToast('⚠️ التعليق يحتوي على كلمات ممنوعة');
    text = filterBadWords(text);
    
    const commentRef = db.ref(`comments/${currentTweetId}`).push();
    await commentRef.set({
        userId: currentUser.uid,
        userName: currentUser.displayName || currentUser.name,
        userAvatar: currentUser.avatar || "",
        text: text,
        timestamp: Date.now()
    });
    
    const tweetRef = db.ref(`tweets/${currentTweetId}`);
    const snapshot = await tweetRef.once('value');
    const tweet = snapshot.val();
    await tweetRef.update({ commentsCount: (tweet.commentsCount || 0) + 1 });
    
    if (tweet.userId !== currentUser.uid) {
        await db.ref(`notifications/${tweet.userId}`).push({
            type: 'comment', userId: currentUser.uid, userName: currentUser.displayName || currentUser.name,
            tweetId: currentTweetId, text: text.substring(0, 50), timestamp: Date.now(), read: false
        });
    }
    
    document.getElementById('commentInput').value = '';
    await loadComments(currentTweetId);
    refreshFeedCache();
    showToast('💬 تم إضافة التعليق');
}

// ==================== Bad Words Management ====================
async function loadBadWordsList() {
    const snapshot = await db.ref('badWords').once('value');
    const words = snapshot.val();
    badWordsList = words ? Object.values(words) : [];
}

async function addBadWord(word) {
    if (!word.trim()) return;
    const newWordRef = db.ref('badWords').push();
    await newWordRef.set(word.trim().toLowerCase());
    await loadBadWordsList();
    showToast(`✅ تمت إضافة كلمة: ${word}`);
    if (currentUser?.isAdmin) openAdminPanel();
}

async function removeBadWord(wordId, word) {
    await db.ref(`badWords/${wordId}`).remove();
    await loadBadWordsList();
    showToast(`🗑️ تم حذف كلمة: ${word}`);
    if (currentUser?.isAdmin) openAdminPanel();
}

function showAddBadWordModal() {
    const word = prompt('📝 أدخل الكلمة التي تريد منعها:');
    if (word && word.trim()) { addBadWord(word.trim()); }
}

// ==================== Settings ====================
function toggleTheme() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    showToast(isDark ? '🌙 الوضع الليلي' : '☀️ الوضع النهاري');
}

// ==================== Logout ====================
async function logout() {
    try {
        await auth.signOut();
        localStorage.removeItem('auth_logged_in');
        localStorage.removeItem('auth_user_email');
        showToast('👋 تم تسجيل الخروج');
        setTimeout(() => { window.location.href = 'auth.html'; }, 1000);
    } catch (error) { showToast('❌ حدث خطأ'); }
}

// ==================== Profile ====================
async function openMyProfile() { if (currentUser) openProfile(currentUser.uid); }

async function openProfile(userId) {
    currentProfileUser = userId;
    const snapshot = await db.ref(`users/${userId}`).once('value');
    const userData = snapshot.val();
    if (!userData) return;
    
    const tweetsSnapshot = await db.ref('tweets').once('value');
    const tweets = tweetsSnapshot.val();
    const userTweets = tweets ? Object.values(tweets).filter(t => t.userId === userId).length : 0;
    
    const followersSnapshot = await db.ref(`followers/${userId}`).once('value');
    const followingSnapshot = await db.ref(`following/${userId}`).once('value');
    const followersCount = followersSnapshot.exists() ? Object.keys(followersSnapshot.val()).length : 0;
    const followingCount = followingSnapshot.exists() ? Object.keys(followingSnapshot.val()).length : 0;
    
    const isFollowing = await checkIfFollowing(userId);
    const isOwner = userId === currentUser.uid;
    
    let adminButtons = '';
    if (currentUser.isAdmin && !isOwner) {
        adminButtons = `<button class="follow-btn" onclick="verifyUser('${userId}')" style="background: #00BA7C;">✅ توثيق</button>
                        <button class="follow-btn" onclick="deleteUser('${userId}')" style="background: #F4212E;">🗑️ حذف</button>`;
    }
    
    const profileHtml = `
        <div class="profile-header">
            <div class="profile-avatar-large" onclick="${isOwner ? "document.getElementById('avatarInput').click()" : ""}" style="cursor: ${isOwner ? 'pointer' : 'default'};">
                ${userData.avatar ? `<img src="${userData.avatar}">` : '<i class="fa-solid fa-user text-white text-4xl"></i>'}
                ${isOwner ? '<div class="avatar-overlay"><i class="fa-solid fa-camera"></i></div>' : ''}
            </div>
            <div class="profile-name-large">${escapeHtml(userData.name)} ${userData.verified ? '<i class="fa-solid fa-circle-check verified-badge" style="font-size: 20px;"></i>' : ''}</div>
            <div class="profile-bio">${escapeHtml(userData.bio || '')}</div>
            ${userData.website ? `<div><a href="${userData.website}" target="_blank" class="profile-website">${userData.website}</a></div>` : ''}
            <div class="profile-stats">
                <div class="profile-stat" onclick="openUserTweets('${userId}')"><div class="profile-stat-number">${userTweets}</div><div class="profile-stat-label">تغريدات</div></div>
                <div class="profile-stat" onclick="openFollowersList('followers', '${userId}')"><div class="profile-stat-number">${followersCount}</div><div class="profile-stat-label">متابع</div></div>
                <div class="profile-stat" onclick="openFollowersList('following', '${userId}')"><div class="profile-stat-number">${followingCount}</div><div class="profile-stat-label">يتابع</div></div>
            </div>
            <div class="profile-buttons">
                ${!isOwner ? `<button class="follow-btn ${isFollowing ? 'following' : ''}" onclick="toggleFollow('${userId}')">${isFollowing ? 'متابَع' : 'متابعة'}</button>` : ''}
                ${!isOwner ? `<button class="follow-btn" onclick="openChat('${userId}')">رسالة</button>` : ''}
                ${isOwner ? `<button class="follow-btn" onclick="openEditProfileModal()">تعديل الملف</button>` : ''}
                ${adminButtons}
            </div>
        </div>
        <div class="profile-tabs"><button class="active" onclick="loadUserTweets('${userId}', 'tweets')">التغريدات</button><button onclick="loadUserTweets('${userId}', 'media')">الوسائط</button></div>
        <div id="profileTweetsContainer"></div>
    `;
    
    document.getElementById('profileContent').innerHTML = profileHtml;
    document.getElementById('profilePanel').classList.add('open');
    await loadUserTweets(userId, 'tweets');
}

function closeProfile() { document.getElementById('profilePanel').classList.remove('open'); }

async function loadUserTweets(userId, type) {
    const tweetsSnapshot = await db.ref('tweets').once('value');
    const tweets = tweetsSnapshot.val();
    if (!tweets) {
        document.getElementById('profileTweetsContainer').innerHTML = '<div style="text-align: center; padding: 20px; color: #536471;">لا توجد تغريدات بعد</div>';
        return;
    }
    let userTweets = Object.values(tweets).filter(t => t.userId === userId).sort((a, b) => b.timestamp - a.timestamp);
    if (type === 'media') { userTweets = userTweets.filter(t => t.mediaUrl); }
    if (userTweets.length === 0) {
        document.getElementById('profileTweetsContainer').innerHTML = '<div style="text-align: center; padding: 20px; color: #536471;">لا توجد تغريدات بعد</div>';
        return;
    }
    let html = '';
    for (const tweet of userTweets.slice(0, 20)) { html += await createTweetCard(tweet); }
    document.getElementById('profileTweetsContainer').innerHTML = html;
}

function openUserTweets(userId) { if (currentProfileUser === userId) { loadUserTweets(userId, 'tweets'); } }

function openEditProfileModal() {
    document.getElementById('editName').value = currentUser.displayName || currentUser.name || '';
    document.getElementById('editBio').value = currentUser.bio || '';
    document.getElementById('editWebsite').value = currentUser.website || '';
    const editAvatar = document.getElementById('editAvatar');
    if (editAvatar && currentUser.avatar) {
        editAvatar.innerHTML = `<img src="${currentUser.avatar}"><div class="avatar-overlay"><i class="fa-solid fa-camera"></i></div>`;
    } else if (editAvatar) {
        editAvatar.innerHTML = `<i class="fa-solid fa-user text-white text-3xl"></i><div class="avatar-overlay"><i class="fa-solid fa-camera"></i></div>`;
    }
    document.getElementById('editProfileModal').classList.add('open');
}

function closeEditProfileModal() { document.getElementById('editProfileModal').classList.remove('open'); }

async function saveProfileEdit() {
    const newName = document.getElementById('editName')?.value;
    const newBio = document.getElementById('editBio')?.value;
    const newWebsite = document.getElementById('editWebsite')?.value;
    try {
        showToast('🔄 جاري حفظ التغييرات...');
        if (newName && newName.trim() && newName.trim() !== currentUser.displayName) {
            await currentUser.updateProfile({ displayName: newName.trim() });
            currentUser.displayName = newName.trim();
        }
        const updates = {};
        if (newName && newName.trim()) updates.name = newName.trim();
        if (newBio !== undefined) updates.bio = newBio || "";
        if (newWebsite !== undefined) updates.website = newWebsite || "";
        await db.ref(`users/${currentUser.uid}`).update(updates);
        if (newName && newName.trim()) currentUser.name = newName.trim();
        if (newBio !== undefined) currentUser.bio = newBio || "";
        if (newWebsite !== undefined) currentUser.website = newWebsite || "";
        closeEditProfileModal();
        if (currentProfileUser === currentUser.uid) { await openProfile(currentUser.uid); }
        refreshFeedCache();
        showToast('✅ تم حفظ التغييرات بنجاح');
    } catch (error) { console.error('Save profile error:', error); showToast('❌ حدث خطأ أثناء حفظ التغييرات'); }
}

// ==================== Follow System ====================
async function checkIfFollowing(userId) {
    const snapshot = await db.ref(`followers/${userId}/${currentUser.uid}`).once('value');
    return snapshot.exists();
}

async function toggleFollow(userId) {
    const isFollowing = await checkIfFollowing(userId);
    if (isFollowing) {
        await db.ref(`followers/${userId}/${currentUser.uid}`).remove();
        await db.ref(`following/${currentUser.uid}/${userId}`).remove();
        showToast('❌ تم إلغاء المتابعة');
    } else {
        await db.ref(`followers/${userId}/${currentUser.uid}`).set({ uid: currentUser.uid, name: currentUser.displayName || currentUser.name, timestamp: Date.now() });
        await db.ref(`following/${currentUser.uid}/${userId}`).set({ uid: userId, timestamp: Date.now() });
        showToast('✅ تم المتابعة');
        await db.ref(`notifications/${userId}`).push({ type: 'follow', userId: currentUser.uid, userName: currentUser.displayName || currentUser.name, timestamp: Date.now(), read: false });
    }
    if (currentProfileUser === userId) openProfile(userId);
    loadSuggestions();
}

// ==================== Suggestions ====================
async function loadSuggestions() {
    const usersSnapshot = await db.ref('users').once('value');
    const users = usersSnapshot.val();
    if (!users) return;
    const suggestions = [];
    for (const [uid, user] of Object.entries(users)) {
        if (uid !== currentUser.uid) {
            const isFollowing = await checkIfFollowing(uid);
            if (!isFollowing) { suggestions.push({ uid, ...user }); }
        }
    }
    const topSuggestions = suggestions.slice(0, 3);
    const container = document.getElementById('suggestionsList');
    if (container && topSuggestions.length > 0) {
        container.innerHTML = topSuggestions.map(user => `
            <div class="follow-item" onclick="openProfile('${user.uid}')">
                <div class="follow-info">
                    <div class="follow-avatar">${user.avatar ? `<img src="${user.avatar}">` : '<i class="fa-solid fa-user text-white"></i>'}</div>
                    <div><div class="follow-name">${escapeHtml(user.name)}</div><div class="follow-username">@${escapeHtml(user.name)}</div></div>
                </div>
                <button class="follow-btn" onclick="event.stopPropagation(); toggleFollow('${user.uid}')">متابعة</button>
            </div>
        `).join('');
    }
}

// ==================== Followers/Following List ====================
async function openFollowersList(type, userId) {
    const targetUserId = userId || currentProfileUser;
    const refPath = type === 'followers' ? `followers/${targetUserId}` : `following/${targetUserId}`;
    const snapshot = await db.ref(refPath).once('value');
    const data = snapshot.val();
    if (!data) { showToast(`لا يوجد ${type === 'followers' ? 'متابعون' : 'متابَعون'}`); return; }
    let html = `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;"><h3 style="font-weight: 700;">${type === 'followers' ? 'المتابعون' : 'المتابَعون'}</h3><button onclick="this.closest('.modal-overlay').remove()" style="background: none; border: none; font-size: 24px;">&times;</button></div>`;
    for (const [uid] of Object.entries(data)) {
        const userSnapshot = await db.ref(`users/${uid}`).once('value');
        const user = userSnapshot.val();
        if (user) {
            html += `<div class="follow-item" onclick="openProfile('${uid}'); this.closest('.modal-overlay').remove();"><div class="follow-info"><div class="follow-avatar">${user.avatar ? `<img src="${user.avatar}">` : '<i class="fa-solid fa-user text-white"></i>'}</div><div><div class="follow-name">${escapeHtml(user.name)}</div><div class="follow-username">@${escapeHtml(user.name)}</div></div></div></div>`;
        }
    }
    const modal = document.createElement('div');
    modal.className = 'modal-overlay open';
    modal.innerHTML = `<div class="modal-content" style="max-width: 400px;">${html}</div>`;
    document.body.appendChild(modal);
}

// ==================== Trending Hashtags ====================
async function loadTrendingHashtags() {
    const hashtagSnapshot = await db.ref('hashtags').once('value');
    const hashtags = hashtagSnapshot.val();
    if (!hashtags) return;
    const trending = [];
    for (const [tag, posts] of Object.entries(hashtags)) { trending.push({ tag, count: Object.keys(posts).length }); }
    trending.sort((a, b) => b.count - a.count);
    const top5 = trending.slice(0, 5);
    const container = document.getElementById('trendingList');
    if (container) {
        container.innerHTML = top5.map(item => `
            <div class="trending-item" onclick="searchHashtag('${item.tag}')">
                <div class="trending-category">الاتجاهات</div>
                <div class="trending-hashtag">#${escapeHtml(item.tag)}</div>
                <div class="trending-count">${item.count} تغريدة</div>
            </div>
        `).join('');
    }
}

// ==================== Search ====================
async function searchHashtag(tag) { openSearch(); document.getElementById('modalSearchInput').value = `#${tag}`; await modalSearch(); }
function openSearch() { document.getElementById('searchPanel').classList.add('open'); }
function closeSearch() { document.getElementById('searchPanel').classList.remove('open'); document.getElementById('modalSearchInput').value = ''; document.getElementById('modalSearchResults').innerHTML = ''; }
async function searchAll() { const query = document.getElementById('searchInput')?.value.toLowerCase(); if (query) await performSearch(query); }
async function modalSearch() { const query = document.getElementById('modalSearchInput')?.value.toLowerCase(); if (!query) { document.getElementById('modalSearchResults').innerHTML = ''; return; } await performSearch(query); }

async function performSearch(query) {
    const usersSnapshot = await db.ref('users').once('value');
    const users = usersSnapshot.val();
    const hashtagSnapshot = await db.ref('hashtags').once('value');
    const hashtags = hashtagSnapshot.val();
    let results = [];
    if (users) { results.push(...Object.values(users).filter(u => u.name?.toLowerCase().includes(query) || u.email?.toLowerCase().includes(query)).map(u => ({ type: 'user', data: u }))); }
    if (hashtags && query.startsWith('#')) { const tag = query.substring(1); if (hashtags[tag]) results.push({ type: 'hashtag', data: { tag: tag, count: Object.keys(hashtags[tag]).length } }); }
    let html = '';
    for (const result of results) {
        if (result.type === 'user') {
            html += `<div class="follow-item" onclick="closeSearch(); openProfile('${result.data.uid}')"><div class="follow-info"><div class="follow-avatar">${result.data.avatar ? `<img src="${result.data.avatar}">` : '<i class="fa-solid fa-user text-white"></i>'}</div><div><div class="follow-name">${escapeHtml(result.data.name)}</div><div class="follow-username">@${escapeHtml(result.data.name)}</div></div></div></div>`;
        } else if (result.type === 'hashtag') {
            html += `<div class="trending-item" onclick="closeSearch(); searchHashtag('${result.data.tag}')"><div class="trending-category">الهاشتاغ</div><div class="trending-hashtag">#${escapeHtml(result.data.tag)}</div><div class="trending-count">${result.data.count} تغريدة</div></div>`;
        }
    }
    const container = document.getElementById('modalSearchResults');
    if (container) container.innerHTML = html || '<div style="text-align: center; padding: 20px; color: #536471;">لا توجد نتائج</div>';
}

// ==================== Notifications ====================
async function loadNotifications() {
    if (!currentUser) return;
    db.ref(`notifications/${currentUser.uid}`).on('value', (snapshot) => {
        const notifications = snapshot.val();
        const notifIcon = document.querySelector('.sidebar-item:nth-child(3) i');
        if (notifIcon && notifications) {
            const unread = Object.values(notifications).filter(n => !n.read).length;
            notifIcon.style.color = unread > 0 ? '#1D9BF0' : '';
            if (unread > 0) { notifIcon.classList.add('notification-new'); setTimeout(() => notifIcon.classList.remove('notification-new'), 500); }
        }
    });
}

async function openNotifications() {
    const snapshot = await db.ref(`notifications/${currentUser.uid}`).once('value');
    const notifications = snapshot.val();
    const container = document.getElementById('notificationsList');
    if (!notifications) {
        container.innerHTML = '<div style="text-align: center; padding: 20px; color: #536471;">لا توجد إشعارات</div>';
    } else {
        let html = '';
        const sorted = Object.entries(notifications).sort((a, b) => b[1].timestamp - a[1].timestamp);
        for (const [id, notif] of sorted) {
            let actionText = '';
            if (notif.type === 'like') actionText = 'أعجب بتغريدتك';
            else if (notif.type === 'retweet') actionText = 'أعاد تغريد تغريدتك';
            else if (notif.type === 'comment') actionText = `علق على تغريدتك: "${notif.text}"`;
            else if (notif.type === 'follow') actionText = 'بدأ بمتابعتك';
            html += `<div class="follow-item" onclick="markNotificationRead('${id}'); ${notif.type === 'follow' ? `openProfile('${notif.userId}')` : `openComments('${notif.tweetId}')`}; closeNotifications();"><div class="follow-info"><div class="follow-avatar"><i class="fa-solid ${notif.type === 'like' ? 'fa-heart' : notif.type === 'retweet' ? 'fa-retweet' : notif.type === 'comment' ? 'fa-comment' : 'fa-user-plus'}" style="color: #1D9BF0;"></i></div><div><div class="follow-name">${escapeHtml(notif.userName)}</div><div style="font-size: 13px;">${actionText}</div><div style="font-size: 11px; color: #536471;">${formatTime(notif.timestamp)}</div></div></div></div>`;
        }
        container.innerHTML = html;
    }
    document.getElementById('notificationsPanel').classList.add('open');
    const updates = {};
    for (const id of Object.keys(notifications)) { updates[`notifications/${currentUser.uid}/${id}/read`] = true; }
    await db.ref().update(updates);
}

function closeNotifications() { document.getElementById('notificationsPanel').classList.remove('open'); }
async function markNotificationRead(notifId) { await db.ref(`notifications/${currentUser.uid}/${notifId}`).update({ read: true }); }

// ==================== Conversations ====================
async function openConversations() {
    const snapshot = await db.ref('chats').once('value');
    const chats = snapshot.val();
    const container = document.getElementById('conversationsList');
    if (!chats) { container.innerHTML = '<div style="text-align: center; padding: 20px; color: #536471;">لا توجد محادثات</div>'; }
    else {
        const conversations = [];
        for (const [chatId, messages] of Object.entries(chats)) {
            const [user1, user2] = chatId.split('_');
            const otherUserId = user1 === currentUser.uid ? user2 : user1;
            const userSnapshot = await db.ref(`users/${otherUserId}`).once('value');
            const userData = userSnapshot.val();
            const messagesArray = Object.values(messages);
            const lastMessage = messagesArray.sort((a, b) => b.timestamp - a.timestamp)[0];
            conversations.push({ userId: otherUserId, userData, lastMessage, timestamp: lastMessage.timestamp });
        }
        conversations.sort((a, b) => b.timestamp - a.timestamp);
        let html = '';
        for (const conv of conversations) {
            html += `<div class="follow-item" onclick="closeConversations(); openChat('${conv.userId}')"><div class="follow-info"><div class="follow-avatar">${conv.userData?.avatar ? `<img src="${conv.userData.avatar}">` : '<i class="fa-solid fa-user text-white"></i>'}</div><div><div class="follow-name">${escapeHtml(conv.userData?.name || 'مستخدم')}</div><div style="font-size: 12px; color: #536471;">${conv.lastMessage.text ? conv.lastMessage.text.substring(0, 30) : (conv.lastMessage.imageUrl ? 'صورة' : '')}</div></div></div></div>`;
        }
        container.innerHTML = html;
    }
    document.getElementById('conversationsPanel').classList.add('open');
}

function closeConversations() { document.getElementById('conversationsPanel').classList.remove('open'); }

// ==================== Chat ====================
async function openChat(userId) {
    const snapshot = await db.ref(`users/${userId}`).once('value');
    currentChatUser = snapshot.val();
    document.getElementById('chatUserName').innerHTML = escapeHtml(currentChatUser.name);
    await loadChatMessages(userId);
    document.getElementById('chatPanel').classList.add('open');
}

function closeChat() {
    document.getElementById('chatPanel').classList.remove('open');
    if (currentChatUser) { const chatId = getChatId(currentUser.uid, currentChatUser.uid); db.ref(`chats/${chatId}`).off(); }
    currentChatUser = null;
}

function getChatId(user1, user2) { return [user1, user2].sort().join('_'); }

async function loadChatMessages(userId) {
    const chatId = getChatId(currentUser.uid, userId);
    db.ref(`chats/${chatId}`).off();
    db.ref(`chats/${chatId}`).on('value', (snapshot) => {
        const messages = snapshot.val();
        const container = document.getElementById('chatMessages');
        if (!container) return;
        if (!messages) { container.innerHTML = '<div style="text-align: center; padding: 20px; color: #536471;">لا توجد رسائل بعد</div>'; return; }
        let html = '';
        const messagesArray = Object.values(messages).sort((a, b) => a.timestamp - b.timestamp);
        for (const msg of messagesArray) {
            const isSent = msg.senderId === currentUser.uid;
            html += `<div class="chat-message" style="display: flex; justify-content: ${isSent ? 'flex-end' : 'flex-start'}; margin-bottom: 12px;"><div style="background: ${isSent ? '#1D9BF0' : '#EFF3F4'}; color: ${isSent ? 'white' : '#0F1419'}; padding: 10px 14px; border-radius: 20px; max-width: 70%;">${msg.text ? escapeHtml(msg.text) : ''}${msg.imageUrl ? `<img src="${msg.imageUrl}" style="max-width: 200px; border-radius: 12px; margin-top: 8px; cursor: pointer;" onclick="openMediaViewer('${msg.imageUrl}', 'image')">` : ''}${msg.audioUrl ? `<audio controls src="${msg.audioUrl}" style="max-width: 200px;"></audio>` : ''}</div></div>`;
        }
        container.innerHTML = html;
        container.scrollTop = container.scrollHeight;
    });
}

async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    let text = input?.value;
    if (!text || !currentChatUser) return;
    if (containsBadWords(text)) return showToast('⚠️ الرسالة تحتوي على كلمات ممنوعة');
    text = filterBadWords(text);
    const chatId = getChatId(currentUser.uid, currentChatUser.uid);
    await db.ref(`chats/${chatId}`).push({ senderId: currentUser.uid, text: text, timestamp: Date.now(), read: false });
    input.value = '';
    loadChatMessages(currentChatUser.uid);
}

async function sendChatImage(input) {
    const file = input.files[0];
    if (file && currentChatUser) {
        showToast('🔄 جاري رفع الصورة...');
        const url = await uploadToCloudinary(file);
        if (url) {
            const chatId = getChatId(currentUser.uid, currentChatUser.uid);
            await db.ref(`chats/${chatId}`).push({ senderId: currentUser.uid, imageUrl: url, timestamp: Date.now(), read: false });
            showToast('✅ تم إرسال الصورة');
            loadChatMessages(currentChatUser.uid);
        }
    }
    input.value = '';
}

// ==================== Infinite Scroll - Core Functions ====================
async function loadAllTweetsToCache() {
    const feedContainer = document.getElementById('feedContainer');
    if (!feedContainer) return;
    const snapshot = await db.ref('tweets').once('value');
    const tweets = snapshot.val();
    if (!tweets || Object.keys(tweets).length === 0) {
        feedContainer.innerHTML = '<div style="text-align: center; padding: 40px; color: #536471;">✨ لا توجد تغريدات بعد - كن أول من يغرد! ✨</div>';
        hasMoreTweets = false;
        return;
    }
    let tweetsArray = Object.values(tweets).sort((a, b) => b.timestamp - a.timestamp);
    if (currentUser) {
        const blockedSnapshot = await db.ref(`users/${currentUser.uid}/blockedUsers`).once('value');
        const blockedUsers = blockedSnapshot.val() || {};
        tweetsArray = tweetsArray.filter(tweet => !blockedUsers[tweet.userId]);
    }
    allTweetsCache = tweetsArray;
    hasMoreTweets = allTweetsCache.length > TWEETS_PER_BATCH;
    currentDisplayCount = TWEETS_PER_BATCH;
    feedContainer.innerHTML = '';
    await displayTweets(0, TWEETS_PER_BATCH);
    if (scrollListenerActive) { setupSmoothScrollListener(); }
}

async function displayTweets(startIndex, count) {
    const feedContainer = document.getElementById('feedContainer');
    if (!feedContainer) return;
    const endIndex = Math.min(startIndex + count, allTweetsCache.length);
    const tweetsToShow = allTweetsCache.slice(startIndex, endIndex);
    for (const tweet of tweetsToShow) {
        const tweetHtml = await createTweetCard(tweet);
        feedContainer.insertAdjacentHTML('beforeend', tweetHtml);
    }
    if (hasMoreTweets && endIndex < allTweetsCache.length) {
        let loadMoreDiv = document.getElementById('loadMoreTrigger');
        if (!loadMoreDiv) { loadMoreDiv = document.createElement('div'); loadMoreDiv.id = 'loadMoreTrigger'; loadMoreDiv.className = 'load-more-btn'; loadMoreDiv.innerHTML = 'جاري تحميل المزيد...'; loadMoreDiv.style.display = 'none'; feedContainer.appendChild(loadMoreDiv); }
    } else if (allTweetsCache.length > 0 && endIndex >= allTweetsCache.length) {
        const loadMoreDiv = document.getElementById('loadMoreTrigger'); if (loadMoreDiv) loadMoreDiv.remove();
        const endMessage = document.createElement('div'); endMessage.style.textAlign = 'center'; endMessage.style.padding = '20px'; endMessage.style.color = '#536471'; endMessage.innerHTML = '✨ لقد وصلت إلى النهاية ✨'; feedContainer.appendChild(endMessage);
    }
}

async function createTweetCard(tweet) {
    const userInfoSnapshot = await db.ref(`users/${tweet.userId}`).once('value');
    const userInfo = userInfoSnapshot.val();
    const isUserVerified = userInfo?.verified || false;
    const isLiked = tweet.likes && tweet.likes[currentUser?.uid];
    const isRetweeted = tweet.retweets && tweet.retweets[currentUser?.uid];
    const likesCount = tweet.likes ? Object.keys(tweet.likes).length : 0;
    const retweetsCount = tweet.retweets ? Object.keys(tweet.retweets).length : 0;
    const isOwner = tweet.userId === currentUser?.uid;
    let formattedText = escapeHtml(tweet.text);
    if (tweet.hashtags) {
        tweet.hashtags.forEach(tag => { const regex = new RegExp(`#${tag}`, 'gi'); formattedText = formattedText.replace(regex, `<span style="color: #1D9BF0; cursor: pointer;" onclick="event.stopPropagation(); searchHashtag('${tag}')">#${tag}</span>`); });
    }
    let mediaHtml = '';
    if (tweet.mediaUrl) {
        if (tweet.mediaType === 'image') { mediaHtml = `<div class="post-media" onclick="event.stopPropagation(); openMediaViewer('${tweet.mediaUrl}', 'image')"><img src="${tweet.mediaUrl}" loading="lazy"></div>`; }
        else if (tweet.mediaType === 'video') { mediaHtml = `<div class="post-media" onclick="event.stopPropagation(); openMediaViewer('${tweet.mediaUrl}', 'video')"><video src="${tweet.mediaUrl}" preload="metadata"></video></div>`; }
    }
    return `<div class="post-card fade-in" data-tweet-id="${tweet.id}"><div class="post-header"><div class="post-avatar" onclick="event.stopPropagation(); openProfile('${tweet.userId}')">${tweet.userAvatar ? `<img src="${tweet.userAvatar}">` : '<i class="fa-solid fa-user text-white"></i>'}</div><div class="post-content"><div class="post-user-info"><span class="post-name" onclick="event.stopPropagation(); openProfile('${tweet.userId}')">${escapeHtml(tweet.userName)}</span>${isUserVerified ? '<i class="fa-solid fa-circle-check verified-badge"></i>' : ''}<span class="post-username">@${escapeHtml(tweet.userName)}</span><span class="post-time">· ${formatTime(tweet.timestamp)}</span>${(isOwner || currentUser?.isAdmin) ? `<button class="post-action" onclick="event.stopPropagation(); deleteTweet('${tweet.id}')" style="margin-right: auto;"><i class="fa-regular fa-trash-can"></i></button>` : ''}</div><div class="post-text" onclick="openComments('${tweet.id}')">${formattedText}</div>${mediaHtml}<div class="post-actions"><button class="post-action" onclick="event.stopPropagation(); openComments('${tweet.id}')"><i class="fa-regular fa-comment"></i> <span>${tweet.commentsCount || 0}</span></button><button class="post-action ${isRetweeted ? 'retweeted' : ''}" onclick="event.stopPropagation(); retweet('${tweet.id}')"><i class="fa-solid fa-retweet"></i> <span>${retweetsCount}</span></button><button class="post-action ${isLiked ? 'liked' : ''}" onclick="event.stopPropagation(); likeTweet('${tweet.id}')"><i class="fa-regular fa-heart"></i> <span>${likesCount}</span></button><button class="post-action" onclick="event.stopPropagation(); shareTweet('${tweet.id}')"><i class="fa-regular fa-share-from-square"></i></button></div></div></div></div>`;
}

function shareTweet(tweetId) { const url = `${window.location.origin}?tweet=${tweetId}`; navigator.clipboard?.writeText(url).then(() => showToast('🔗 تم نسخ رابط التغريدة')).catch(() => showToast('🔗 رابط التغريدة: ' + url)); }

async function loadMoreTweets() {
    if (isLoadingMore || !hasMoreTweets) return;
    isLoadingMore = true;
    const loadMoreDiv = document.getElementById('loadMoreTrigger'); if (loadMoreDiv) loadMoreDiv.style.display = 'block';
    await new Promise(resolve => setTimeout(resolve, 200));
    const startIndex = currentDisplayCount;
    const newEndIndex = Math.min(startIndex + TWEETS_PER_BATCH, allTweetsCache.length);
    if (startIndex < allTweetsCache.length) { await displayTweets(startIndex, TWEETS_PER_BATCH); currentDisplayCount = newEndIndex; hasMoreTweets = currentDisplayCount < allTweetsCache.length; }
    else { hasMoreTweets = false; }
    if (loadMoreDiv) loadMoreDiv.style.display = 'none';
    isLoadingMore = false;
}

function setupSmoothScrollListener() {
    const handleScroll = () => { if (isLoadingMore || !hasMoreTweets) return; const scrollPosition = window.innerHeight + window.scrollY; const threshold = document.body.offsetHeight - 500; if (scrollPosition >= threshold) { loadMoreTweets(); } };
    window.removeEventListener('scroll', handleScroll);
    window.addEventListener('scroll', handleScroll, { passive: true });
}

async function refreshFeedCache() {
    if (!currentUser) return;
    const snapshot = await db.ref('tweets').once('value');
    const tweets = snapshot.val();
    if (!tweets || Object.keys(tweets).length === 0) { allTweetsCache = []; hasMoreTweets = false; currentDisplayCount = 0; const feedContainer = document.getElementById('feedContainer'); if (feedContainer) { feedContainer.innerHTML = '<div style="text-align: center; padding: 40px; color: #536471;">✨ لا توجد تغريدات بعد - كن أول من يغرد! ✨</div>'; } return; }
    let tweetsArray = Object.values(tweets).sort((a, b) => b.timestamp - a.timestamp);
    const blockedSnapshot = await db.ref(`users/${currentUser.uid}/blockedUsers`).once('value');
    const blockedUsers = blockedSnapshot.val() || {};
    tweetsArray = tweetsArray.filter(tweet => !blockedUsers[tweet.userId]);
    allTweetsCache = tweetsArray;
    hasMoreTweets = allTweetsCache.length > TWEETS_PER_BATCH;
    currentDisplayCount = Math.min(TWEETS_PER_BATCH, allTweetsCache.length);
    const feedContainer = document.getElementById('feedContainer');
    if (feedContainer) { feedContainer.innerHTML = ''; await displayTweets(0, currentDisplayCount); }
}

function resetInfiniteScroll() { isLoadingMore = false; hasMoreTweets = true; allTweetsCache = []; currentDisplayCount = 0; scrollListenerActive = true; }
async function loadFeed() { await loadAllTweetsToCache(); }

// ==================== Admin Panel ====================
async function openAdminPanel() {
    if (currentUser.email !== ADMIN_EMAIL && !currentUser.isAdmin) return showToast('🚫 غير مصرح لك');
    showToast('🔧 جاري تحميل لوحة التحكم...');
    const badWordsSnapshot = await db.ref('badWords').once('value');
    const badWords = badWordsSnapshot.val();
    const badWordsContainer = document.getElementById('adminBadWordsList');
    if (badWordsContainer) {
        if (!badWords) { badWordsContainer.innerHTML = '<div style="padding: 12px; color: #536471;">📝 لا توجد كلمات ممنوعة</div>'; }
        else { let html = ''; for (const [id, word] of Object.entries(badWords)) { html += `<div class="admin-item"><div><span class="admin-item-name">🚫 ${escapeHtml(word)}</span></div><button class="admin-delete-btn" onclick="removeBadWord('${id}', '${word}')">حذف</button></div>`; } badWordsContainer.innerHTML = html; }
    }
    const usersSnapshot = await db.ref('users').once('value');
    const tweetsSnapshot = await db.ref('tweets').once('value');
    const usersCount = usersSnapshot.exists() ? Object.keys(usersSnapshot.val()).length : 0;
    const tweetsCount = tweetsSnapshot.exists() ? Object.keys(tweetsSnapshot.val()).length : 0;
    document.getElementById('adminUsersCount').textContent = usersCount;
    document.getElementById('adminTweetsCount').textContent = tweetsCount;
    let usersHtml = '';
    if (usersSnapshot.exists()) {
        for (const [uid, user] of Object.entries(usersSnapshot.val())) {
            if (uid !== currentUser.uid) {
                usersHtml += `<div class="admin-item"><div><div class="admin-item-name">${escapeHtml(user.name)}</div><div class="admin-item-email">${escapeHtml(user.email)}</div></div><div>${!user.verified ? `<button class="admin-verify-btn" onclick="verifyUser('${uid}')">✅ توثيق</button>` : '<span style="color: #00BA7C;">✅ موثق</span>'}<button class="admin-delete-btn" onclick="deleteUser('${uid}')">🗑️ حذف</button></div></div>`;
            }
        }
    }
    document.getElementById('adminUsersList').innerHTML = usersHtml || '<div style="padding: 12px; color: #536471;">لا يوجد مستخدمين</div>';
    document.getElementById('adminPanel').classList.add('open');
}

function closeAdmin() { document.getElementById('adminPanel').classList.remove('open'); }

async function verifyUser(userId) {
    await db.ref(`users/${userId}`).update({ verified: true });
    showToast('✅ تم توثيق المستخدم');
    if (currentProfileUser === userId) openProfile(userId);
    refreshFeedCache(); openAdminPanel();
}

async function deleteUser(userId) {
    if (confirm('⚠️ هل أنت متأكد من حذف هذا المستخدم نهائياً؟')) { await db.ref(`users/${userId}`).remove(); showToast('🗑️ تم حذف المستخدم'); openAdminPanel(); refreshFeedCache(); }
}

// ==================== Close Functions ====================
function closeCompose() { document.getElementById('composeModal').classList.remove('open'); document.getElementById('composeText').value = ''; removeComposeMedia(); tweetMediaFile = null; }
function openCompose() { document.getElementById('composeModal').classList.add('open'); }
function goToHome() { refreshFeedCache(); }
function switchTab(tab) { if (tab === 'home') { refreshFeedCache(); } }

// ==================== Last Seen Update ====================
setInterval(async () => { if (currentUser) await db.ref(`users/${currentUser.uid}/lastSeen`).set(Date.now()); }, 60000);

// ==================== Auth State Listener ====================
const initLoader = document.getElementById('initLoader');
auth.onAuthStateChanged(async (user) => {
    if (initLoader) { setTimeout(() => { initLoader.style.opacity = '0'; setTimeout(() => { if (initLoader) initLoader.style.display = 'none'; }, 300); }, 500); }
    if (user) {
        currentUser = user;
        const snapshot = await db.ref(`users/${user.uid}`).once('value');
        if (snapshot.exists()) { currentUser = { ...currentUser, ...snapshot.val() }; }
        else { await db.ref(`users/${user.uid}`).set({ uid: user.uid, name: user.displayName || user.email.split('@')[0], email: user.email, bio: "مرحباً! أنا في XSphere ✨", avatar: "", cover: "", website: "", verified: false, isAdmin: user.email === ADMIN_EMAIL, blockedUsers: {}, createdAt: Date.now() }); currentUser.isAdmin = user.email === ADMIN_EMAIL; }
        document.getElementById('mainApp').style.display = 'block';
        const avatarDiv = document.getElementById('currentUserAvatar'); if (avatarDiv && currentUser.avatar) { avatarDiv.innerHTML = `<img src="${currentUser.avatar}">`; }
        if (currentUser.isAdmin) { const adminItem = document.getElementById('adminSidebarItem'); if (adminItem) adminItem.style.display = 'flex'; }
        await loadBadWordsList();
        resetInfiniteScroll();
        await loadFeed();
        loadNotifications();
        loadTrendingHashtags();
        loadSuggestions();
        const savedTheme = localStorage.getItem('theme'); if (savedTheme === 'dark') document.body.classList.add('dark-mode');
    } else { window.location.href = 'auth.html'; }
});

// ==================== إضافات تجميلية جديدة ====================
window.addEventListener('scroll', () => {
    const scrollProgress = document.getElementById('scrollProgress');
    if (scrollProgress) { const scrollTop = window.scrollY; const docHeight = document.documentElement.scrollHeight - window.innerHeight; const scrollPercent = (scrollTop / docHeight) * 100; scrollProgress.style.width = scrollPercent + '%'; }
});

const originalLikeTweet = likeTweet;
likeTweet = async function(tweetId) {
    await originalLikeTweet(tweetId);
    const likeBtn = document.querySelector(`.post-action[onclick*="likeTweet('${tweetId}')"]`);
    if (likeBtn) { likeBtn.classList.add('heart-burst'); setTimeout(() => likeBtn.classList.remove('heart-burst'), 400); }
};

const originalRetweet = retweet;
retweet = async function(tweetId) {
    await originalRetweet(tweetId);
    const retweetBtn = document.querySelector(`.post-action[onclick*="retweet('${tweetId}')"]`);
    if (retweetBtn) { retweetBtn.style.transform = 'scale(1.2)'; setTimeout(() => retweetBtn.style.transform = 'scale(1)', 200); }
};

const originalOpenNotifications = openNotifications;
openNotifications = async function() {
    await originalOpenNotifications();
    const notifPanel = document.getElementById('notificationsPanel');
    if (notifPanel) { notifPanel.classList.add('notification-new'); setTimeout(() => notifPanel.classList.remove('notification-new'), 500); }
};

const originalLoadFeed = loadFeed;
loadFeed = async function() {
    await originalLoadFeed();
    document.querySelectorAll('.post-card').forEach((card, index) => { card.style.animationDelay = (index * 0.03) + 's'; });
};

document.addEventListener('keydown', (e) => {
    if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && document.activeElement?.tagName !== 'TEXTAREA' && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); openCompose(); }
    if (e.key === 'Escape') { closeCompose(); closeCommentsModal(); closeConversations(); closeChat(); closeNotifications(); closeSearch(); closeProfile(); closeEditProfileModal(); closeAdmin(); closeMediaViewer(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { if (document.getElementById('composeModal').classList.contains('open')) { submitComposeTweet(); } else if (document.getElementById('tweetText') === document.activeElement) { createTweet(); } else if (document.getElementById('chatInput') === document.activeElement) { sendChatMessage(); } }
    if (e.key === '?' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); showToast('⌨️ N: تغريدة جديدة | ESC: إغلاق | Ctrl+Enter: نشر | ?: المساعدة', 4000); }
});

console.log('✅ XSphere - جميع الإضافات التجميلية مفعلة');
