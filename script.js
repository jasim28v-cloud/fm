// ==================== X Platform - Script ====================
let currentUser = null;
let currentPostId = null;
let currentChatUser = null;
let currentProfileUser = null;
let selectedMediaFile = null;
let allPostsCache = [];
let currentDisplayCount = 0;
let isLoadingMore = false;
let hasMorePosts = true;
let badWordsList = [];
const POSTS_PER_BATCH = 10;

// Helper Functions
function showToast(message, duration = 2000) {
    const toast = document.getElementById('customToast');
    if (!toast) return;
    toast.textContent = message;
    toast.style.opacity = '1';
    setTimeout(() => toast.style.opacity = '0', duration);
}

function formatTime(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days} ي`;
    if (hours > 0) return `${hours} س`;
    if (minutes > 0) return `${minutes} د`;
    return `${seconds} ث`;
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

function updateCharCounter() {
    const textarea = document.getElementById('postText');
    const counter = document.getElementById('charCounter');
    const length = textarea.value.length;
    counter.textContent = `${length} / 280`;
    counter.classList.toggle('warning', length > 260);
}

function containsBadWords(text) {
    if (!text || badWordsList.length === 0) return false;
    const lowerText = text.toLowerCase();
    for (const word of badWordsList) if (lowerText.includes(word.toLowerCase())) return true;
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

// Upload to Cloudinary
async function uploadToCloudinary(file) {
    const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/upload`;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', UPLOAD_PRESET);
    
    const progressDiv = document.getElementById('uploadProgress');
    const progressFill = document.getElementById('progressFill');
    progressDiv.style.display = 'block';
    progressFill.style.width = '0%';
    
    try {
        let progress = 0;
        const interval = setInterval(() => {
            if (progress < 90) { progress += 10; progressFill.style.width = progress + '%'; }
        }, 200);
        const response = await fetch(url, { method: 'POST', body: formData });
        clearInterval(interval);
        const data = await response.json();
        if (data.secure_url) {
            progressFill.style.width = '100%';
            setTimeout(() => progressDiv.style.display = 'none', 500);
            return data.secure_url;
        }
        throw new Error('Upload failed');
    } catch (error) {
        showToast('فشل رفع الملف');
        progressDiv.style.display = 'none';
        return null;
    }
}

function handleFileSelect(input, type) {
    const file = input.files[0];
    if (file) {
        selectedMediaFile = file;
        const previewImage = document.getElementById('previewImage');
        const previewVideo = document.getElementById('previewVideo');
        const previewDiv = document.getElementById('mediaPreview');
        previewDiv.classList.add('active');
        if (type === 'image') {
            previewImage.style.display = 'block';
            previewVideo.style.display = 'none';
            previewImage.src = URL.createObjectURL(file);
        } else {
            previewImage.style.display = 'none';
            previewVideo.style.display = 'block';
            previewVideo.src = URL.createObjectURL(file);
        }
    }
}

function removeSelectedMedia() {
    selectedMediaFile = null;
    document.getElementById('mediaPreview').classList.remove('active');
    document.getElementById('postImage').value = '';
    document.getElementById('postVideo').value = '';
}

// Bad Words
async function loadBadWordsList() {
    const snapshot = await db.ref('badWords').once('value');
    badWordsList = snapshot.val() ? Object.values(snapshot.val()) : [];
}

// Create Post
async function createPost() {
    let text = document.getElementById('postText')?.value;
    if (containsBadWords(text)) return showToast('⚠️ المنشور يحتوي على كلمات ممنوعة');
    if (!text && !selectedMediaFile) return showToast('⚠️ الرجاء كتابة نص أو إضافة وسائط');
    text = filterBadWords(text);
    
    let mediaUrl = "", mediaType = "";
    if (selectedMediaFile) {
        mediaType = selectedMediaFile.type.split('/')[0];
        mediaUrl = await uploadToCloudinary(selectedMediaFile);
        if (!mediaUrl) return;
    }
    
    const hashtags = extractHashtags(text);
    const postRef = db.ref('posts').push();
    await postRef.set({
        id: postRef.key, userId: currentUser.uid, userName: currentUser.displayName || currentUser.name,
        userAvatar: currentUser.avatar || "", text: text, mediaUrl: mediaUrl, mediaType: mediaType,
        hashtags: hashtags, likes: {}, views: 0, commentsCount: 0, timestamp: Date.now()
    });
    
    for (const tag of hashtags) await db.ref(`hashtags/${tag.toLowerCase()}/${postRef.key}`).set(true);
    
    document.getElementById('postText').value = "";
    removeSelectedMedia();
    closeCompose();
    await refreshFeedCache();
    loadTrendingHashtags();
    showToast('✨ تم نشر المنشور');
}

async function deletePost(postId) {
    if (!confirm('هل أنت متأكد من حذف المنشور؟')) return;
    const postSnapshot = await db.ref(`posts/${postId}`).once('value');
    const post = postSnapshot.val();
    if (post.userId !== currentUser.uid && !currentUser.isAdmin) return showToast('لا يمكنك حذف هذا المنشور');
    if (post.hashtags) for (const tag of post.hashtags) await db.ref(`hashtags/${tag.toLowerCase()}/${postId}`).remove();
    await db.ref(`posts/${postId}`).remove();
    await refreshFeedCache();
    showToast('🗑️ تم الحذف');
}

async function likePost(postId) {
    const likeRef = db.ref(`posts/${postId}/likes/${currentUser.uid}`);
    const snapshot = await likeRef.once('value');
    if (snapshot.exists()) await likeRef.remove();
    else {
        await likeRef.set(true);
        const postSnapshot = await db.ref(`posts/${postId}`).once('value');
        const post = postSnapshot.val();
        if (post && post.userId !== currentUser.uid) {
            await db.ref(`notifications/${post.userId}`).push({
                type: 'like', userId: currentUser.uid, userName: currentUser.displayName || currentUser.name,
                postId: postId, timestamp: Date.now(), read: false
            });
        }
    }
    refreshFeedCache();
}

async function savePost(postId) {
    const saveRef = db.ref(`savedPosts/${currentUser.uid}/${postId}`);
    const snapshot = await saveRef.once('value');
    if (snapshot.exists()) { await saveRef.remove(); showToast('📌 تم إزالة من المحفوظة'); }
    else { await saveRef.set(true); showToast('💾 تم الحفظ'); }
    refreshFeedCache();
}

// Comments
async function openComments(postId) {
    currentPostId = postId;
    document.getElementById('commentsPanel').classList.add('open');
    await loadComments(postId);
}

async function loadComments(postId) {
    const snapshot = await db.ref(`comments/${postId}`).once('value');
    const comments = snapshot.val();
    const container = document.getElementById('commentsList');
    if (!comments) { container.innerHTML = '<div style="text-align:center;padding:20px;color:#71767b;">لا توجد ردود</div>'; return; }
    let html = '';
    for (const [id, comment] of Object.entries(comments)) {
        const userSnapshot = await db.ref(`users/${comment.userId}`).once('value');
        const user = userSnapshot.val();
        html += `<div class="message-bubble received"><strong>${escapeHtml(user?.name || 'مستخدم')}</strong><br>${escapeHtml(comment.text)}<br><small>${formatTime(comment.timestamp)}</small></div>`;
    }
    container.innerHTML = html;
}

async function addComment() {
    let text = document.getElementById('commentInput')?.value;
    if (!text || !currentPostId) return;
    if (containsBadWords(text)) return showToast('⚠️ تعليق ممنوع');
    text = filterBadWords(text);
    await db.ref(`comments/${currentPostId}`).push({
        userId: currentUser.uid, userName: currentUser.displayName || currentUser.name,
        text: text, timestamp: Date.now()
    });
    await db.ref(`posts/${currentPostId}/commentsCount`).transaction(c => (c || 0) + 1);
    document.getElementById('commentInput').value = '';
    loadComments(currentPostId);
    showToast('💬 تم إضافة الرد');
}

function closeComments() { document.getElementById('commentsPanel').classList.remove('open'); }

// Feed
async function loadAllPostsToCache() {
    const snapshot = await db.ref('posts').once('value');
    const posts = snapshot.val();
    const feedContainer = document.getElementById('postsContainer');
    if (!posts) { feedContainer.innerHTML = '<div style="text-align:center;padding:32px;color:#71767b;">لا توجد منشورات</div>'; return; }
    let postsArray = Object.values(posts).sort((a, b) => b.timestamp - a.timestamp);
    if (currentUser) {
        const blockedSnapshot = await db.ref(`users/${currentUser.uid}/blockedUsers`).once('value');
        const blocked = blockedSnapshot.val() || {};
        postsArray = postsArray.filter(p => !blocked[p.userId]);
    }
    allPostsCache = postsArray;
    currentDisplayCount = POSTS_PER_BATCH;
    hasMorePosts = allPostsCache.length > POSTS_PER_BATCH;
    feedContainer.innerHTML = '';
    await displayPosts(0, POSTS_PER_BATCH);
}

async function displayPosts(start, count) {
    const container = document.getElementById('postsContainer');
    const end = Math.min(start + count, allPostsCache.length);
    for (let i = start; i < end; i++) {
        const post = allPostsCache[i];
        const isLiked = post.likes && post.likes[currentUser?.uid];
        const likesCount = post.likes ? Object.keys(post.likes).length : 0;
        const savedSnapshot = currentUser ? await db.ref(`savedPosts/${currentUser.uid}/${post.id}`).once('value') : { exists: () => false };
        const isSaved = savedSnapshot.exists();
        let mediaHtml = '';
        if (post.mediaUrl) {
            mediaHtml = `<div class="post-media">${post.mediaType === 'image' ? `<img src="${post.mediaUrl}">` : `<video src="${post.mediaUrl}" controls></video>`}</div>`;
        }
        let textHtml = escapeHtml(post.text);
        if (post.hashtags) post.hashtags.forEach(t => textHtml = textHtml.replace(new RegExp(`#${t}`, 'gi'), `<span class="post-hashtags" onclick="searchHashtag('${t}')">#${t}</span>`));
        
        const html = `
            <div class="post-card" data-post-id="${post.id}">
                <div class="post-header">
                    <div class="post-avatar" onclick="openProfile('${post.userId}')">${post.userAvatar ? `<img src="${post.userAvatar}">` : '<i class="fa-solid fa-user"></i>'}</div>
                    <div class="post-content">
                        <div class="post-user-row">
                            <span class="post-username" onclick="openProfile('${post.userId}')">${escapeHtml(post.userName)}</span>
                            <span class="post-handle">@${escapeHtml(post.userName?.replace(/\s/g, '').toLowerCase() || 'user')}</span>
                            <span class="post-time">· ${formatTime(post.timestamp)}</span>
                        </div>
                        <div class="post-text">${textHtml}</div>
                        ${mediaHtml}
                        <div class="post-actions">
                            <button class="post-action ${isLiked ? 'liked' : ''}" onclick="event.stopPropagation(); likePost('${post.id}')"><i class="fa-regular fa-heart"></i> ${likesCount || ''}</button>
                            <button class="post-action" onclick="event.stopPropagation(); openComments('${post.id}')"><i class="fa-regular fa-comment"></i> ${post.commentsCount || ''}</button>
                            <button class="post-action"><i class="fa-regular fa-retweet"></i></button>
                            <button class="post-action ${isSaved ? 'saved' : ''}" onclick="event.stopPropagation(); savePost('${post.id}')"><i class="fa-regular fa-bookmark"></i></button>
                            <button class="post-action" onclick="event.stopPropagation(); deletePost('${post.id}')"><i class="fa-regular fa-trash-can"></i></button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', html);
    }
    if (hasMorePosts && end < allPostsCache.length) {
        const trigger = document.createElement('div');
        trigger.id = 'loadMoreTrigger';
        trigger.style.height = '20px';
        container.appendChild(trigger);
        const observer = new IntersectionObserver((e) => { if (e[0].isIntersecting) loadMorePosts(); });
        observer.observe(trigger);
    }
}

async function loadMorePosts() {
    if (isLoadingMore || !hasMorePosts) return;
    isLoadingMore = true;
    const start = currentDisplayCount;
    const newEnd = Math.min(start + POSTS_PER_BATCH, allPostsCache.length);
    await displayPosts(start, POSTS_PER_BATCH);
    currentDisplayCount = newEnd;
    hasMorePosts = currentDisplayCount < allPostsCache.length;
    isLoadingMore = false;
}

async function refreshFeedCache() { await loadAllPostsToCache(); }

// Profile
async function openMyProfile() { if (currentUser) openProfile(currentUser.uid); }
async function openProfile(userId) {
    currentProfileUser = userId;
    const snapshot = await db.ref(`users/${userId}`).once('value');
    const user = snapshot.val();
    if (!user) return;
    document.getElementById('profileName').textContent = user.name;
    document.getElementById('profileHandle').textContent = `@${user.name?.replace(/\s/g, '').toLowerCase() || 'user'}`;
    document.getElementById('profileBio').textContent = user.bio || '';
    const followers = await db.ref(`followers/${userId}`).once('value');
    const following = await db.ref(`following/${userId}`).once('value');
    document.getElementById('profileFollowersCount').textContent = followers.exists() ? Object.keys(followers.val()).length : 0;
    document.getElementById('profileFollowingCount').textContent = following.exists() ? Object.keys(following.val()).length : 0;
    
    const avatarEl = document.getElementById('profileAvatarLarge');
    avatarEl.innerHTML = user.avatar ? `<img src="${user.avatar}" style="width:100%;height:100%;object-fit:cover;">` : '<i class="fa-solid fa-user"></i>';
    
    const btnDiv = document.getElementById('profileButtons');
    if (userId !== currentUser.uid) {
        const isFollowing = (await db.ref(`followers/${userId}/${currentUser.uid}`).once('value')).exists();
        btnDiv.innerHTML = `<button class="publish-btn" style="padding:8px 16px;" onclick="toggleFollow('${userId}')">${isFollowing ? 'إلغاء المتابعة' : 'متابعة'}</button>
                           <button class="publish-btn" style="background:transparent;border:1px solid #536471;" onclick="openChat('${userId}')">رسالة</button>`;
    } else {
        btnDiv.innerHTML = `<button class="publish-btn" style="padding:8px 16px;" onclick="openEditProfileModal()">تعديل</button>`;
        if (currentUser.isAdmin || currentUser.email === ADMIN_EMAIL) btnDiv.innerHTML += `<button class="publish-btn" style="background:transparent;" onclick="openAdminPanel()">لوحة التحكم</button>`;
    }
    await loadProfilePosts(userId);
    document.getElementById('profilePanel').classList.add('open');
}

async function loadProfilePosts(userId) {
    const postsSnapshot = await db.ref('posts').once('value');
    const posts = postsSnapshot.val();
    const userPosts = posts ? Object.values(posts).filter(p => p.userId === userId).sort((a,b) => b.timestamp - a.timestamp) : [];
    const grid = document.getElementById('profilePostsGrid');
    grid.innerHTML = userPosts.map(p => `<div style="aspect-ratio:1;background:#1d9bf0;display:flex;align-items:center;justify-content:center;cursor:pointer;" onclick="openComments('${p.id}')">${p.mediaUrl ? `<img src="${p.mediaUrl}" style="width:100%;height:100%;object-fit:cover;">` : '<i class="fa-regular fa-message"></i>'}</div>`).join('') || '<div style="grid-column:span 3;text-align:center;padding:32px;">لا توجد منشورات</div>';
}

async function loadProfileMedia(userId) {
    const postsSnapshot = await db.ref('posts').once('value');
    const posts = postsSnapshot.val();
    const userPosts = posts ? Object.values(posts).filter(p => p.userId === userId && p.mediaUrl).sort((a,b) => b.timestamp - a.timestamp) : [];
    const grid = document.getElementById('profilePostsGrid');
    grid.innerHTML = userPosts.map(p => `<div style="aspect-ratio:1;" onclick="openComments('${p.id}')"><img src="${p.mediaUrl}" style="width:100%;height:100%;object-fit:cover;"></div>`).join('') || '<div style="grid-column:span 3;text-align:center;padding:32px;">لا توجد وسائط</div>';
}

async function toggleFollow(userId) {
    const ref = db.ref(`followers/${userId}/${currentUser.uid}`);
    if ((await ref.once('value')).exists()) {
        await ref.remove();
        await db.ref(`following/${currentUser.uid}/${userId}`).remove();
    } else {
        await ref.set({ uid: currentUser.uid, timestamp: Date.now() });
        await db.ref(`following/${currentUser.uid}/${userId}`).set({ uid: userId, timestamp: Date.now() });
        await db.ref(`notifications/${userId}`).push({ type: 'follow', userId: currentUser.uid, userName: currentUser.name, timestamp: Date.now() });
    }
    openProfile(userId);
}

function closeProfile() { document.getElementById('profilePanel').classList.remove('open'); }

function openEditProfileModal() {
    const newName = prompt('الاسم الجديد:', currentUser.name);
    if (newName) {
        currentUser.updateProfile({ displayName: newName });
        db.ref(`users/${currentUser.uid}`).update({ name: newName });
        updateSidebarUser();
        showToast('تم تحديث الملف');
    }
}

// Chat
async function openChat(userId) {
    const snapshot = await db.ref(`users/${userId}`).once('value');
    currentChatUser = snapshot.val();
    document.getElementById('chatUserName').textContent = currentChatUser.name;
    document.getElementById('chatPanel').classList.add('open');
    const chatId = [currentUser.uid, userId].sort().join('_');
    db.ref(`chats/${chatId}`).on('value', (snap) => {
        const messages = snap.val();
        const container = document.getElementById('chatMessages');
        if (!messages) { container.innerHTML = '<div style="text-align:center;padding:20px;">لا توجد رسائل</div>'; return; }
        container.innerHTML = Object.values(messages).sort((a,b) => a.timestamp - b.timestamp).map(m => `<div class="message-bubble ${m.senderId === currentUser.uid ? 'sent' : 'received'}">${escapeHtml(m.text || '')}</div>`).join('');
    });
}

async function sendChatMessage() {
    const input = document.getElementById('chatMessageInput');
    const text = input.value;
    if (!text || !currentChatUser) return;
    const chatId = [currentUser.uid, currentChatUser.uid].sort().join('_');
    await db.ref(`chats/${chatId}`).push({ senderId: currentUser.uid, text: filterBadWords(text), timestamp: Date.now() });
    input.value = '';
}

function closeChat() { document.getElementById('chatPanel').classList.remove('open'); }

async function openConversations() {
    const container = document.getElementById('conversationsList');
    const snapshot = await db.ref('chats').once('value');
    const chats = snapshot.val();
    if (!chats) { container.innerHTML = '<div>لا توجد محادثات</div>'; }
    else {
        let html = '';
        for (const chatId of Object.keys(chats)) {
            const users = chatId.split('_');
            const otherId = users[0] === currentUser.uid ? users[1] : users[0];
            const userSnap = await db.ref(`users/${otherId}`).once('value');
            const user = userSnap.val();
            if (user) html += `<div style="padding:12px;border-bottom:1px solid #2f3336;cursor:pointer;" onclick="closeConversations();openChat('${otherId}')">${user.name}</div>`;
        }
        container.innerHTML = html;
    }
    document.getElementById('conversationsPanel').classList.add('open');
}
function closeConversations() { document.getElementById('conversationsPanel').classList.remove('open'); }

// Notifications
async function openNotifications() {
    const container = document.getElementById('notificationsList');
    const snapshot = await db.ref(`notifications/${currentUser.uid}`).once('value');
    const notifs = snapshot.val();
    container.innerHTML = notifs ? Object.values(notifs).sort((a,b) => b.timestamp - a.timestamp).map(n => `<div style="padding:12px;border-bottom:1px solid #2f3336;">${n.userName} ${n.type === 'like' ? 'أعجب بمنشورك' : 'تابعك'}</div>`).join('') : '<div>لا توجد إشعارات</div>';
    document.getElementById('notificationsPanel').classList.add('open');
}
function closeNotifications() { document.getElementById('notificationsPanel').classList.remove('open'); }

// Search
async function searchAll() {
    const query = document.getElementById('searchInput')?.value.toLowerCase();
    if (!query) return;
    const usersSnap = await db.ref('users').once('value');
    const users = usersSnap.val();
    const results = users ? Object.values(users).filter(u => u.name?.toLowerCase().includes(query) || u.email?.toLowerCase().includes(query)) : [];
    document.getElementById('searchResults').innerHTML = results.map(u => `<div style="padding:12px;cursor:pointer;" onclick="closeSearch();openProfile('${u.uid}')">${u.name} (@${u.email?.split('@')[0]})</div>`).join('');
}
function openSearch() { document.getElementById('searchPanel').classList.add('open'); }
function closeSearch() { document.getElementById('searchPanel').classList.remove('open'); }
async function searchHashtag(tag) { openSearch(); document.getElementById('searchInput').value = `#${tag}`; searchAll(); }

// Saved Posts
async function openSavedPosts() {
    const container = document.getElementById('savedPostsGrid');
    const snapshot = await db.ref(`savedPosts/${currentUser.uid}`).once('value');
    const saved = snapshot.val();
    if (!saved) { container.innerHTML = '<div>لا توجد محفوظات</div>'; }
    else {
        let html = '';
        for (const postId of Object.keys(saved)) {
            const postSnap = await db.ref(`posts/${postId}`).once('value');
            const post = postSnap.val();
            if (post) html += `<div style="aspect-ratio:1;cursor:pointer;" onclick="openComments('${postId}')">${post.mediaUrl ? `<img src="${post.mediaUrl}" style="width:100%;height:100%;object-fit:cover;">` : post.text?.substring(0,50)}</div>`;
        }
        container.innerHTML = html;
    }
    document.getElementById('savedPostsPanel').classList.add('open');
}
function closeSavedPosts() { document.getElementById('savedPostsPanel').classList.remove('open'); }

// Trending
async function loadTrendingHashtags() {
    const snapshot = await db.ref('hashtags').once('value');
    const hashtags = snapshot.val();
    if (!hashtags) return;
    const trending = Object.entries(hashtags).map(([tag, posts]) => ({ tag, count: Object.keys(posts).length })).sort((a,b) => b.count - a.count).slice(0, 5);
    document.getElementById('trendingList').innerHTML = trending.map(t => `<div class="trending-item" onclick="searchHashtag('${t.tag}')"><div class="trending-category">الأكثر تداولاً</div><div class="trending-hashtag">#${t.tag}</div><div class="trending-count">${t.count} منشور</div></div>`).join('');
}

// Admin
async function openAdminPanel() {
    if (currentUser.email !== ADMIN_EMAIL && !currentUser.isAdmin) return showToast('غير مصرح');
    const badWordsSnap = await db.ref('badWords').once('value');
    const badWords = badWordsSnap.val();
    const container = document.getElementById('adminBadWordsList');
    container.innerHTML = badWords ? Object.entries(badWords).map(([id, w]) => `<div>${w} <button onclick="removeBadWord('${id}','${w}')">حذف</button></div>`).join('') : '<div>لا توجد كلمات</div>';
    container.innerHTML += `<button onclick="showAddBadWordModal()">+ إضافة كلمة</button>`;
    
    const usersSnap = await db.ref('users').once('value');
    const users = usersSnap.val();
    const usersContainer = document.getElementById('adminUsersList');
    usersContainer.innerHTML = users ? Object.entries(users).filter(([id]) => id !== currentUser.uid).map(([id, u]) => `<div>${u.name} ${!u.verified ? `<button onclick="verifyUser('${id}')">توثيق</button>` : '✅'} <button onclick="deleteUser('${id}')">حذف</button></div>`).join('') : '';
    document.getElementById('adminPanel').classList.add('open');
}

async function verifyUser(userId) { await db.ref(`users/${userId}`).update({ verified: true }); showToast('✅ تم التوثيق'); openAdminPanel(); }
async function deleteUser(userId) { if (confirm('حذف المستخدم؟')) { await db.ref(`users/${userId}`).remove(); showToast('تم الحذف'); openAdminPanel(); } }
function closeAdmin() { document.getElementById('adminPanel').classList.remove('open'); }
async function addBadWord(word) { if (!word.trim()) return; await db.ref('badWords').push(word.trim().toLowerCase()); await loadBadWordsList(); showToast(`✅ تمت إضافة: ${word}`); }
async function removeBadWord(wordId, word) { await db.ref(`badWords/${wordId}`).remove(); await loadBadWordsList(); showToast(`🗑️ تم حذف: ${word}`); }
function showAddBadWordModal() { const word = prompt('أدخل الكلمة الممنوعة:'); if (word) addBadWord(word); }

// UI Helpers
function openCompose() { document.getElementById('composeModal').classList.add('open'); updateCharCounter(); }
function closeCompose() { document.getElementById('composeModal').classList.remove('open'); }
function addPollToCompose() { showToast('الاستطلاعات قريباً'); }
function toggleTheme() { document.body.classList.toggle('light-mode'); localStorage.setItem('theme', document.body.classList.contains('light-mode') ? 'light' : 'dark'); }
function switchTab(tab) { if (tab === 'home') refreshFeedCache(); }

async function logout() { await auth.signOut(); localStorage.removeItem('auth_logged_in'); window.location.href = 'auth.html'; }

function updateSidebarUser() {
    if (!currentUser) return;
    document.getElementById('sidebarName').textContent = currentUser.displayName || currentUser.name;
    document.getElementById('sidebarHandle').textContent = `@${(currentUser.email || '').split('@')[0]}`;
    const avatar = document.getElementById('sidebarAvatar');
    avatar.innerHTML = currentUser.avatar ? `<img src="${currentUser.avatar}" style="width:100%;height:100%;object-fit:cover;">` : '<i class="fa-solid fa-user"></i>';
}

// Auth State
const initLoader = document.getElementById('initLoader');
auth.onAuthStateChanged(async (user) => {
    if (initLoader) { initLoader.style.opacity = '0'; setTimeout(() => initLoader.style.display = 'none', 300); }
    if (user) {
        currentUser = user;
        const snapshot = await db.ref(`users/${user.uid}`).once('value');
        if (snapshot.exists()) currentUser = { ...currentUser, ...snapshot.val() };
        else {
            await db.ref(`users/${user.uid}`).set({
                uid: user.uid, name: user.displayName || user.email.split('@')[0], email: user.email,
                bio: "", avatar: "", verified: false, isAdmin: user.email === ADMIN_EMAIL, createdAt: Date.now()
            });
            currentUser.isAdmin = user.email === ADMIN_EMAIL;
        }
        document.getElementById('mainApp').style.display = 'block';
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'light') document.body.classList.add('light-mode');
        await loadBadWordsList();
        await loadAllPostsToCache();
        loadTrendingHashtags();
        updateSidebarUser();
    } else {
        window.location.href = 'auth.html';
    }
});
