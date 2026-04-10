// ==========================================
// المتغيرات العامة
// ==========================================
let currentUser = null;
let currentUserData = null;
let mediaRecorder = null;
let audioChunks = [];
let selectedImages = [];
let audioBlob = null;
let isRecording = false;
let selectedCoverFile = null;
let selectedAvatarFile = null;
let currentViewingUserId = null;
let allUsers = {};
let allPosts = {};

// ==========================================
// التهيئة عند تحميل الصفحة
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            currentUser = user;
            await loadCurrentUserData();
            await loadTweets();
            await loadSuggestedUsers();
            await loadTrendingTopics();
            await loadAllUsers();
            setupComposeInput();
            setupPresence();
            
            // إظهار لوحة التحكم للمدير
            if (currentUserData?.isAdmin || user.email === ADMIN_EMAIL) {
                document.getElementById('adminNavItem').style.display = 'flex';
            }
        } else {
            window.location.href = 'auth.html';
        }
    });
    
    // مستمعات تحميل الصور
    document.getElementById('imageInput').addEventListener('change', handleImageSelect);
    document.getElementById('coverInput').addEventListener('change', handleCoverSelect);
    document.getElementById('avatarEditInput').addEventListener('change', handleAvatarSelect);
});

// ==========================================
// تحميل بيانات المستخدم الحالي
// ==========================================
async function loadCurrentUserData() {
    const snapshot = await db.ref('users/' + currentUser.uid).once('value');
    currentUserData = snapshot.val() || {};
    
    // تحديث واجهة المستخدم
    document.getElementById('currentUserNameMini').textContent = currentUserData.name || 'مستخدم';
    document.getElementById('currentUserUsernameMini').textContent = '@' + (currentUserData.username || 'user');
    
    const avatar = document.getElementById('currentUserAvatarMini');
    const composeAvatar = document.getElementById('composeAvatar');
    
    if (currentUserData.avatar) {
        avatar.style.backgroundImage = `url(${currentUserData.avatar})`;
        composeAvatar.style.backgroundImage = `url(${currentUserData.avatar})`;
        avatar.textContent = '';
        composeAvatar.textContent = '';
    } else {
        avatar.textContent = (currentUserData.name || 'U').charAt(0).toUpperCase();
        composeAvatar.textContent = (currentUserData.name || 'U').charAt(0).toUpperCase();
    }
    
    // تحديث حالة الاتصال
    await db.ref('users/' + currentUser.uid).update({ isOnline: true });
}

// ==========================================
// صندوق إنشاء تغريدة
// ==========================================
function setupComposeInput() {
    const input = document.getElementById('composeInput');
    const submitBtn = document.getElementById('composeSubmit');
    
    input.addEventListener('input', () => {
        submitBtn.disabled = !input.value.trim() && selectedImages.length === 0 && !audioBlob;
    });
}

function focusCompose() {
    document.getElementById('composeInput').focus();
}

function handleImageSelect(e) {
    const files = e.target.files;
    const container = document.getElementById('imagePreviewContainer');
    
    for (const file of files) {
        if (file.type.startsWith('image/')) {
            selectedImages.push(file);
            
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = document.createElement('img');
                img.src = event.target.result;
                img.style.width = '60px';
                img.style.height = '60px';
                img.style.borderRadius = '12px';
                img.style.objectFit = 'cover';
                img.style.cursor = 'pointer';
                img.onclick = () => {
                    const index = selectedImages.indexOf(file);
                    if (index > -1) {
                        selectedImages.splice(index, 1);
                        img.remove();
                    }
                };
                container.appendChild(img);
            };
            reader.readAsDataURL(file);
        }
    }
    
    document.getElementById('composeSubmit').disabled = false;
}

async function toggleRecording() {
    const btn = document.getElementById('recordBtn');
    
    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            
            mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
            mediaRecorder.onstop = () => {
                audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                const audioPreview = document.getElementById('audioPreview');
                audioPreview.src = URL.createObjectURL(audioBlob);
                audioPreview.style.display = 'block';
                document.getElementById('composeSubmit').disabled = false;
            };
            
            mediaRecorder.start();
            isRecording = true;
            btn.style.color = '#f4212e';
        } catch (error) {
            alert('لا يمكن الوصول إلى الميكروفون');
        }
    } else {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
        isRecording = false;
        btn.style.color = '';
    }
}

async function createTweet() {
    const content = document.getElementById('composeInput').value.trim();
    
    if (!content && selectedImages.length === 0 && !audioBlob) return;
    
    const submitBtn = document.getElementById('composeSubmit');
    submitBtn.disabled = true;
    submitBtn.textContent = '...';
    
    try {
        const tweetData = {
            userId: currentUser.uid,
            content: content,
            timestamp: Date.now(),
            likes: {},
            retweets: {},
            replies: {},
            isDeleted: false
        };
        
        // رفع الصور
        if (selectedImages.length > 0) {
            tweetData.images = [];
            for (const img of selectedImages) {
                const url = await uploadToCloudinary(img);
                tweetData.images.push(url);
            }
        }
        
        // رفع الصوت
        if (audioBlob) {
            tweetData.audio = await uploadAudioToCloudinary(audioBlob);
        }
        
        await db.ref('tweets').push(tweetData);
        await db.ref('users/' + currentUser.uid).update({
            postsCount: (currentUserData.postsCount || 0) + 1
        });
        
        // إعادة تعيين
        document.getElementById('composeInput').value = '';
        selectedImages = [];
        audioBlob = null;
        document.getElementById('imagePreviewContainer').innerHTML = '';
        document.getElementById('audioPreview').style.display = 'none';
        submitBtn.textContent = 'تغريد';
        
        await loadTweets();
    } catch (error) {
        console.error('Error creating tweet:', error);
        submitBtn.disabled = false;
        submitBtn.textContent = 'تغريد';
    }
}

// ==========================================
// تحميل التغريدات
// ==========================================
async function loadTweets() {
    const container = document.getElementById('tweetsContainer');
    container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i> جاري التحميل...</div>';
    
    try {
        const snapshot = await db.ref('tweets').orderByChild('timestamp').limitToLast(50).once('value');
        const tweets = snapshot.val();
        
        container.innerHTML = '';
        
        if (!tweets) {
            container.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-secondary);">لا توجد تغريدات بعد</div>';
            return;
        }
        
        const tweetsArray = Object.entries(tweets).reverse();
        
        for (const [tweetId, tweet] of tweetsArray) {
            if (tweet.isDeleted) continue;
            
            const userSnapshot = await db.ref('users/' + tweet.userId).once('value');
            const userData = userSnapshot.val();
            
            if (!userData || userData.isBanned) continue;
            
            const tweetEl = await createTweetElement(tweetId, tweet, userData);
            container.appendChild(tweetEl);
        }
    } catch (error) {
        console.error('Error loading tweets:', error);
        container.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-secondary);">حدث خطأ في تحميل التغريدات</div>';
    }
}

async function createTweetElement(tweetId, tweet, userData) {
    const div = document.createElement('div');
    div.className = 'tweet';
    div.dataset.tweetId = tweetId;
    
    const likes = tweet.likes ? Object.keys(tweet.likes).length : 0;
    const retweets = tweet.retweets ? Object.keys(tweet.retweets).length : 0;
    const replies = tweet.replies ? Object.keys(tweet.replies).length : 0;
    const userLiked = tweet.likes && tweet.likes[currentUser?.uid];
    const userRetweeted = tweet.retweets && tweet.retweets[currentUser?.uid];
    
    let html = `
        <div class="tweet-avatar" onclick="viewUserProfile('${tweet.userId}')" style="background-image: url('${userData.avatar || ''}');">
            ${!userData.avatar ? userData.name?.charAt(0).toUpperCase() || 'U' : ''}
        </div>
        <div class="tweet-content">
            <div class="tweet-header">
                <span class="tweet-name" onclick="viewUserProfile('${tweet.userId}')">${userData.name || 'مستخدم'}</span>
                ${userData.isVerified ? '<i class="fas fa-check-circle verified-icon"></i>' : ''}
                <span class="tweet-username">@${userData.username || 'user'}</span>
                <span class="tweet-time">· ${formatTime(tweet.timestamp)}</span>
            </div>
            <div class="tweet-text">${escapeHtml(tweet.content || '')}</div>
    `;
    
    // الصور
    if (tweet.images && tweet.images.length > 0) {
        html += '<div class="tweet-images">';
        tweet.images.forEach(img => {
            html += `<img src="${img}" class="tweet-image" onclick="viewImage('${img}')">`;
        });
        html += '</div>';
    }
    
    // الصوت
    if (tweet.audio) {
        html += `<audio class="tweet-audio" controls src="${tweet.audio}"></audio>`;
    }
    
    html += `
            <div class="tweet-actions">
                <div class="tweet-action" onclick="showReplyModal('${tweetId}')">
                    <i class="far fa-comment"></i>
                    <span>${replies || ''}</span>
                </div>
                <div class="tweet-action ${userRetweeted ? 'retweeted' : ''}" onclick="retweetTweet('${tweetId}')">
                    <i class="fas fa-retweet"></i>
                    <span>${retweets || ''}</span>
                </div>
                <div class="tweet-action ${userLiked ? 'liked' : ''}" onclick="likeTweet('${tweetId}')">
                    <i class="far fa-heart"></i>
                    <span>${likes || ''}</span>
                </div>
                <div class="tweet-action" onclick="bookmarkTweet('${tweetId}')">
                    <i class="far fa-bookmark"></i>
                </div>
                <div class="tweet-action" onclick="shareTweet('${tweetId}')">
                    <i class="fas fa-share"></i>
                </div>
            </div>
        </div>
    `;
    
    div.innerHTML = html;
    return div;
}

// ==========================================
// التفاعل مع التغريدات
// ==========================================
async function likeTweet(tweetId) {
    if (!currentUser) return;
    
    const likeRef = db.ref(`tweets/${tweetId}/likes/${currentUser.uid}`);
    const snapshot = await likeRef.once('value');
    
    if (snapshot.exists()) {
        await likeRef.remove();
    } else {
        await likeRef.set(true);
        
        // إرسال إشعار
        const tweetSnapshot = await db.ref('tweets/' + tweetId).once('value');
        const tweet = tweetSnapshot.val();
        if (tweet.userId !== currentUser.uid) {
            await sendNotification(tweet.userId, `${currentUserData.name} أعجب بتغريدتك`, 'like', tweetId);
        }
    }
    
    await loadTweets();
}

async function retweetTweet(tweetId) {
    if (!currentUser) return;
    
    const retweetRef = db.ref(`tweets/${tweetId}/retweets/${currentUser.uid}`);
    const snapshot = await retweetRef.once('value');
    
    if (snapshot.exists()) {
        await retweetRef.remove();
    } else {
        await retweetRef.set(true);
        
        const tweetSnapshot = await db.ref('tweets/' + tweetId).once('value');
        const tweet = tweetSnapshot.val();
        if (tweet.userId !== currentUser.uid) {
            await sendNotification(tweet.userId, `${currentUserData.name} أعاد تغريد تغريدتك`, 'retweet', tweetId);
        }
    }
    
    await loadTweets();
}

async function bookmarkTweet(tweetId) {
    const bookmarkRef = db.ref(`users/${currentUser.uid}/bookmarks/${tweetId}`);
    const snapshot = await bookmarkRef.once('value');
    
    if (snapshot.exists()) {
        await bookmarkRef.remove();
    } else {
        await bookmarkRef.set({ timestamp: Date.now() });
    }
    
    alert(snapshot.exists() ? 'تمت الإزالة من المحفوظات' : 'تمت الإضافة إلى المحفوظات');
}

function shareTweet(tweetId) {
    const url = `${window.location.origin}/tweet/${tweetId}`;
    navigator.clipboard?.writeText(url);
    alert('تم نسخ الرابط');
}

// ==========================================
// تحميل المستخدمين المقترحين
// ==========================================
async function loadSuggestedUsers() {
    const container = document.getElementById('suggestedUsersList');
    
    try {
        const snapshot = await db.ref('users').once('value');
        const users = snapshot.val();
        
        container.innerHTML = '';
        let count = 0;
        
        for (const [userId, userData] of Object.entries(users)) {
            if (userId === currentUser.uid) continue;
            if (userData.isBanned) continue;
            if (currentUserData.following && currentUserData.following[userId]) continue;
            
            if (count++ >= 3) break;
            
            const followItem = document.createElement('div');
            followItem.className = 'follow-item';
            followItem.innerHTML = `
                <div class="follow-info">
                    <div class="follow-avatar" style="background-image: url('${userData.avatar || ''}');" onclick="viewUserProfile('${userId}')">
                        ${!userData.avatar ? (userData.name?.charAt(0) || 'U') : ''}
                    </div>
                    <div>
                        <div class="follow-name" onclick="viewUserProfile('${userId}')">${userData.name || 'مستخدم'}</div>
                        <div class="follow-username">@${userData.username || 'user'}</div>
                    </div>
                </div>
                <button class="follow-btn-small" onclick="followUser('${userId}', this)">متابعة</button>
            `;
            container.appendChild(followItem);
        }
    } catch (error) {
        console.error('Error loading suggested users:', error);
    }
}

async function followUser(userId, btn) {
    try {
        const updates = {};
        updates[`users/${currentUser.uid}/following/${userId}`] = true;
        updates[`users/${userId}/followers/${currentUser.uid}`] = true;
        
        await db.ref().update(updates);
        
        // تحديث العداد
        const userSnapshot = await db.ref('users/' + userId).once('value');
        const userData = userSnapshot.val();
        await db.ref('users/' + userId).update({
            followersCount: (userData.followersCount || 0) + 1
        });
        
        await db.ref('users/' + currentUser.uid).update({
            followingCount: (currentUserData.followingCount || 0) + 1
        });
        
        btn.textContent = 'تمت المتابعة';
        btn.classList.add('following');
        btn.disabled = true;
        
        await sendNotification(userId, `${currentUserData.name} بدأ بمتابعتك`, 'follow');
    } catch (error) {
        console.error('Error following user:', error);
    }
}

// ==========================================
// نافذة تعديل الملف الشخصي
// ==========================================
function openProfileModal() {
    const modal = document.getElementById('profileEditModal');
    
    // ملء البيانات الحالية
    document.getElementById('editName').value = currentUserData.name || '';
    document.getElementById('editBio').value = currentUserData.bio || '';
    document.getElementById('editLocation').value = currentUserData.location || '';
    document.getElementById('editWebsite').value = currentUserData.website || '';
    
    // الصور
    if (currentUserData.coverImage) {
        document.getElementById('coverImageEdit').style.backgroundImage = `url(${currentUserData.coverImage})`;
    }
    if (currentUserData.avatar) {
        document.getElementById('avatarEdit').style.backgroundImage = `url(${currentUserData.avatar})`;
        document.getElementById('avatarEdit').innerHTML = '<span class="avatar-edit-overlay"><i class="fas fa-camera"></i> تغيير</span>';
    }
    
    modal.classList.add('active');
}

function closeProfileEditModal() {
    document.getElementById('profileEditModal').classList.remove('active');
}

function handleCoverSelect(e) {
    const file = e.target.files[0];
    if (file) {
        selectedCoverFile = file;
        const reader = new FileReader();
        reader.onload = (event) => {
            document.getElementById('coverImageEdit').style.backgroundImage = `url(${event.target.result})`;
        };
        reader.readAsDataURL(file);
    }
}

function handleAvatarSelect(e) {
    const file = e.target.files[0];
    if (file) {
        selectedAvatarFile = file;
        const reader = new FileReader();
        reader.onload = (event) => {
            document.getElementById('avatarEdit').style.backgroundImage = `url(${event.target.result})`;
        };
        reader.readAsDataURL(file);
    }
}

async function saveProfile() {
    const name = document.getElementById('editName').value.trim();
    const bio = document.getElementById('editBio').value.trim();
    const location = document.getElementById('editLocation').value.trim();
    const website = document.getElementById('editWebsite').value.trim();
    
    const updates = { name, bio, location, website };
    
    // رفع صورة الغلاف
    if (selectedCoverFile) {
        updates.coverImage = await uploadToCloudinary(selectedCoverFile);
    }
    
    // رفع الصورة الشخصية
    if (selectedAvatarFile) {
        updates.avatar = await uploadToCloudinary(selectedAvatarFile);
    }
    
    try {
        await db.ref('users/' + currentUser.uid).update(updates);
        await loadCurrentUserData();
        closeProfileEditModal();
        alert('تم حفظ التغييرات بنجاح');
    } catch (error) {
        console.error('Error saving profile:', error);
        alert('حدث خطأ في حفظ التغييرات');
    }
}

// ==========================================
// عرض الملف الشخصي
// ==========================================
async function viewUserProfile(userId) {
    currentViewingUserId = userId;
    const modal = document.getElementById('profileViewModal');
    
    const snapshot = await db.ref('users/' + userId).once('value');
    const userData = snapshot.val();
    
    if (!userData) return;
    
    document.getElementById('viewProfileName').textContent = userData.name || 'مستخدم';
    document.getElementById('viewName').textContent = userData.name || 'مستخدم';
    document.getElementById('viewUsername').textContent = '@' + (userData.username || 'user');
    document.getElementById('viewBio').textContent = userData.bio || '';
    document.getElementById('viewLocation').textContent = userData.location || 'غير محدد';
    document.getElementById('viewWebsite').textContent = userData.website || 'غير محدد';
    document.getElementById('viewJoinDate').textContent = formatDate(userData.createdAt);
    document.getElementById('viewFollowing').textContent = userData.followingCount || 0;
    document.getElementById('viewFollowers').textContent = userData.followersCount || 0;
    
    // الصور
    if (userData.coverImage) {
        document.getElementById('viewCoverImage').style.backgroundImage = `url(${userData.coverImage})`;
    }
    if (userData.avatar) {
        document.getElementById('viewAvatar').style.backgroundImage = `url(${userData.avatar})`;
    } else {
        document.getElementById('viewAvatar').textContent = (userData.name || 'U').charAt(0).toUpperCase();
    }
    
    // التوثيق
    document.getElementById('viewVerifiedBadge').style.display = userData.isVerified ? 'inline' : 'none';
    
    // زر المتابعة
    const followBtn = document.getElementById('viewFollowBtn');
    if (userId === currentUser.uid) {
        followBtn.textContent = 'تعديل الملف';
        followBtn.onclick = () => {
            closeProfileViewModal();
            openProfileModal();
        };
    } else {
        const isFollowing = currentUserData.following && currentUserData.following[userId];
        followBtn.textContent = isFollowing ? 'إلغاء المتابعة' : 'متابعة';
        followBtn.classList.toggle('following', isFollowing);
        followBtn.onclick = () => toggleFollowFromView();
    }
    
    // تحميل تغريدات المستخدم
    await loadUserTweets(userId);
    
    modal.classList.add('active');
}

function closeProfileViewModal() {
    document.getElementById('profileViewModal').classList.remove('active');
    currentViewingUserId = null;
}

async function toggleFollowFromView() {
    if (!currentViewingUserId || currentViewingUserId === currentUser.uid) return;
    
    const isFollowing = currentUserData.following && currentUserData.following[currentViewingUserId];
    const btn = document.getElementById('viewFollowBtn');
    
    try {
        if (isFollowing) {
            await db.ref(`users/${currentUser.uid}/following/${currentViewingUserId}`).remove();
            await db.ref(`users/${currentViewingUserId}/followers/${currentUser.uid}`).remove();
            
            const userSnapshot = await db.ref('users/' + currentViewingUserId).once('value');
            const userData = userSnapshot.val();
            await db.ref('users/' + currentViewingUserId).update({
                followersCount: Math.max(0, (userData.followersCount || 0) - 1)
            });
            
            btn.textContent = 'متابعة';
            btn.classList.remove('following');
        } else {
            await db.ref(`users/${currentUser.uid}/following/${currentViewingUserId}`).set(true);
            await db.ref(`users/${currentViewingUserId}/followers/${currentUser.uid}`).set(true);
            
            const userSnapshot = await db.ref('users/' + currentViewingUserId).once('value');
            const userData = userSnapshot.val();
            await db.ref('users/' + currentViewingUserId).update({
                followersCount: (userData.followersCount || 0) + 1
            });
            
            btn.textContent = 'إلغاء المتابعة';
            btn.classList.add('following');
            
            await sendNotification(currentViewingUserId, `${currentUserData.name} بدأ بمتابعتك`, 'follow');
        }
        
        await loadCurrentUserData();
        document.getElementById('viewFollowers').textContent = (await db.ref('users/' + currentViewingUserId).once('value')).val().followersCount || 0;
    } catch (error) {
        console.error('Error toggling follow:', error);
    }
}

async function loadUserTweets(userId) {
    const container = document.getElementById('profileTweetsContainer');
    container.innerHTML = '<div class="loading-spinner">جاري التحميل...</div>';
    
    try {
        const snapshot = await db.ref('tweets').orderByChild('userId').equalTo(userId).once('value');
        const tweets = snapshot.val();
        
        container.innerHTML = '';
        
        if (!tweets) {
            container.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-secondary);">لا توجد تغريدات</div>';
            return;
        }
        
        const tweetsArray = Object.entries(tweets).reverse();
        const userSnapshot = await db.ref('users/' + userId).once('value');
        const userData = userSnapshot.val();
        
        for (const [tweetId, tweet] of tweetsArray) {
            if (tweet.isDeleted) continue;
            const tweetEl = await createTweetElement(tweetId, tweet, userData);
            container.appendChild(tweetEl);
        }
    } catch (error) {
        console.error('Error loading user tweets:', error);
        container.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-secondary);">حدث خطأ</div>';
    }
}

// ==========================================
// لوحة تحكم المدير
// ==========================================
async function openAdminPanel() {
    if (!currentUserData?.isAdmin && currentUser.email !== ADMIN_EMAIL) {
        alert('غير مصرح لك بالوصول');
        return;
    }
    
    document.getElementById('adminPanelModal').classList.add('active');
    await loadAllUsers();
    await loadAdminUsers();
    await loadAdminStats();
}

function closeAdminPanel() {
    document.getElementById('adminPanelModal').classList.remove('active');
}

function switchAdminTab(tab) {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
    
    if (tab === 'users') {
        document.querySelectorAll('.admin-tab')[0].classList.add('active');
        document.getElementById('adminUsersTab').classList.add('active');
    } else if (tab === 'content') {
        document.querySelectorAll('.admin-tab')[1].classList.add('active');
        document.getElementById('adminContentTab').classList.add('active');
        loadAdminContent();
    } else if (tab === 'reports') {
        document.querySelectorAll('.admin-tab')[2].classList.add('active');
        document.getElementById('adminReportsTab').classList.add('active');
        loadAdminReports();
    } else if (tab === 'stats') {
        document.querySelectorAll('.admin-tab')[3].classList.add('active');
        document.getElementById('adminStatsTab').classList.add('active');
        loadAdminStats();
    }
}

async function loadAllUsers() {
    const snapshot = await db.ref('users').once('value');
    allUsers = snapshot.val() || {};
}

async function loadAdminUsers() {
    const container = document.getElementById('adminUsersList');
    container.innerHTML = '';
    
    for (const [userId, userData] of Object.entries(allUsers)) {
        const div = document.createElement('div');
        div.className = 'admin-user-item';
        div.innerHTML = `
            <div class="admin-user-info">
                <div class="admin-user-avatar" style="background-image: url('${userData.avatar || ''}');">
                    ${!userData.avatar ? (userData.name?.charAt(0) || 'U') : ''}
                </div>
                <div>
                    <div>${userData.name || 'مستخدم'} ${userData.isVerified ? '<i class="fas fa-check-circle" style="color: #1d9bf0;"></i>' : ''}</div>
                    <div style="color: #71767b;">@${userData.username || 'user'}</div>
                    <div style="font-size: 12px;">${userData.email || ''}</div>
                    <div style="font-size: 12px;">${userData.isBanned ? '<span style="color: #f4212e;">محظور</span>' : '<span style="color: #00ba7c;">نشط</span>'}</div>
                </div>
            </div>
            <div class="admin-user-actions">
                ${userId !== currentUser.uid ? `
                    <button class="admin-btn verify" onclick="toggleVerifyUser('${userId}')">
                        ${userData.isVerified ? 'إلغاء التوثيق' : 'توثيق'}
                    </button>
                    <button class="admin-btn ban" onclick="toggleBanUser('${userId}')">
                        ${userData.isBanned ? 'إلغاء الحظر' : 'حظر'}
                    </button>
                    <button class="admin-btn warn" onclick="warnUser('${userId}')">تحذير</button>
                ` : '<span style="color: #71767b;">أنت</span>'}
            </div>
        `;
        container.appendChild(div);
    }
}

async function toggleVerifyUser(userId) {
    const userData = allUsers[userId];
    await db.ref('users/' + userId).update({ isVerified: !userData.isVerified });
    await loadAllUsers();
    await loadAdminUsers();
    await loadAdminStats();
}

async function toggleBanUser(userId) {
    const userData = allUsers[userId];
    await db.ref('users/' + userId).update({ isBanned: !userData.isBanned });
    await loadAllUsers();
    await loadAdminUsers();
    await loadAdminStats();
    
    if (!userData.isBanned) {
        await sendNotification(userId, 'تم حظر حسابك من قبل الإدارة', 'ban');
    }
}

function warnUser(userId) {
    const reason = prompt('سبب التحذير:');
    if (reason) {
        sendNotification(userId, `تحذير من الإدارة: ${reason}`, 'warn');
        alert('تم إرسال التحذير');
    }
}

async function loadAdminContent() {
    const container = document.getElementById('adminContentList');
    container.innerHTML = '<div class="loading-spinner">جاري التحميل...</div>';
    
    try {
        const snapshot = await db.ref('tweets').orderByChild('timestamp').limitToLast(30).once('value');
        const tweets = snapshot.val();
        
        container.innerHTML = '';
        
        if (!tweets) {
            container.innerHTML = '<div style="text-align: center; padding: 20px;">لا يوجد محتوى</div>';
            return;
        }
        
        for (const [tweetId, tweet] of Object.entries(tweets).reverse()) {
            const userData = allUsers[tweet.userId] || {};
            
            const div = document.createElement('div');
            div.className = 'admin-user-item';
            div.innerHTML = `
                <div style="flex: 1;">
                    <div><strong>${userData.name || 'مستخدم'}</strong> @${userData.username || 'user'}</div>
                    <div style="margin: 8px 0;">${escapeHtml((tweet.content || '').substring(0, 100))}...</div>
                    <div style="font-size: 12px; color: #71767b;">${formatTime(tweet.timestamp)}</div>
                </div>
                <div>
                    <button class="admin-btn delete" onclick="adminDeleteTweet('${tweetId}')">حذف</button>
                </div>
            `;
            container.appendChild(div);
        }
    } catch (error) {
        console.error('Error loading admin content:', error);
    }
}

async function adminDeleteTweet(tweetId) {
    if (!confirm('هل أنت متأكد من حذف هذه التغريدة؟')) return;
    
    await db.ref('tweets/' + tweetId).update({ isDeleted: true });
    await loadAdminContent();
    alert('تم حذف التغريدة');
}

function loadAdminReports() {
    document.getElementById('adminReportsList').innerHTML = '<div style="text-align: center; padding: 20px;">لا توجد بلاغات حالياً</div>';
}

async function loadAdminStats() {
    const users = allUsers;
    const tweetsSnapshot = await db.ref('tweets').once('value');
    const tweets = tweetsSnapshot.val() || {};
    
    const totalUsers = Object.keys(users).length;
    const totalTweets = Object.values(tweets).filter(t => !t.isDeleted).length;
    const bannedUsers = Object.values(users).filter(u => u.isBanned).length;
    const verifiedUsers = Object.values(users).filter(u => u.isVerified).length;
    const onlineUsers = Object.values(users).filter(u => u.isOnline).length;
    
    document.getElementById('statTotalUsers').textContent = totalUsers;
    document.getElementById('statTotalTweets').textContent = totalTweets;
    document.getElementById('statBannedUsers').textContent = bannedUsers;
    document.getElementById('statVerifiedUsers').textContent = verifiedUsers;
    document.getElementById('statOnlineUsers').textContent = onlineUsers;
    document.getElementById('statReports').textContent = '0';
}

function searchAdminUsers() {
    const query = document.getElementById('adminUserSearch').value.toLowerCase();
    const container = document.getElementById('adminUsersList');
    
    container.innerHTML = '';
    
    for (const [userId, userData] of Object.entries(allUsers)) {
        if (userData.name?.toLowerCase().includes(query) || 
            userData.username?.toLowerCase().includes(query) ||
            userData.email?.toLowerCase().includes(query)) {
            // إعادة عرض المستخدم
        }
    }
}

// ==========================================
// الرسائل
// ==========================================
function showMessages() {
    document.getElementById('messagesModal').classList.add('active');
}

function closeMessagesModal() {
    document.getElementById('messagesModal').classList.remove('active');
}

function newMessage() {
    alert('فتح محادثة جديدة');
}

// ==========================================
// الإشعارات
// ==========================================
async function sendNotification(userId, message, type, relatedId = null) {
    try {
        const notifRef = db.ref(`notifications/${userId}`).push();
        await notifRef.set({
            message: message,
            type: type,
            relatedId: relatedId,
            from: currentUser.uid,
            fromName: currentUserData.name,
            timestamp: Date.now(),
            read: false
        });
    } catch (error) {
        console.error('Error sending notification:', error);
    }
}

function showNotifications() {
    alert('قسم الإشعارات');
}

// ==========================================
// دوال مساعدة
// ==========================================
async function uploadToCloudinary(file) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', UPLOAD_PRESET);
    
    const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
        method: 'POST',
        body: formData
    });
    
    const data = await response.json();
    return data.secure_url;
}

async function uploadAudioToCloudinary(blob) {
    const formData = new FormData();
    formData.append('file', blob);
    formData.append('upload_preset', UPLOAD_PRESET);
    
    const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/video/upload`, {
        method: 'POST',
        body: formData
    });
    
    const data = await response.json();
    return data.secure_url;
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'الآن';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} د`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} س`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} يوم`;
    
    return date.toLocaleDateString('ar');
}

function formatDate(timestamp) {
    if (!timestamp) return 'غير محدد';
    return new Date(timestamp).toLocaleDateString('ar', { year: 'numeric', month: 'long' });
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function setupPresence() {
    const userStatusRef = db.ref(`users/${currentUser.uid}`);
    const connectedRef = db.ref('.info/connected');
    
    connectedRef.on('value', (snap) => {
        if (snap.val() === true) {
            userStatusRef.update({ isOnline: true });
            userStatusRef.child('isOnline').onDisconnect().set(false);
            userStatusRef.child('lastSeen').onDisconnect().set(Date.now());
        }
    });
}

async function loadTrendingTopics() {
    // تنفيذ لاحق
}

function showExplore() {
    alert('قسم الاستكشاف');
}

function showBookmarks() {
    alert('المحفوظات');
}

function showLogoutMenu() {
    if (confirm('هل تريد تسجيل الخروج؟')) {
        logout();
    }
}

async function logout() {
    await db.ref('users/' + currentUser.uid).update({ isOnline: false });
    await auth.signOut();
    window.location.href = 'auth.html';
}

function viewImage(url) {
    window.open(url, '_blank');
}

function showReplyModal(tweetId) {
    alert('الرد على التغريدة');
}

function showFollowingList() {
    alert('قائمة المتابَعين');
}

function showFollowersList() {
    alert('قائمة المتابِعين');
}

console.log("✅ X Platform Ready - Full Clone");
