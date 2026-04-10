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
let isDarkMode = localStorage.getItem('darkMode') === 'true';
let lastLoadedPostKey = null;
let postsPerPage = 10;
let notifications = [];
let currentAudio = null;

// تأثيرات صوتية
const sounds = {
    like: null,
    retweet: null,
    notification: null,
    send: null
};

// ==========================================
// التهيئة عند تحميل الصفحة
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    applyTheme();
    initCharCounter();
    initScrollTopButton();
    initKeyboardShortcuts();
    initImageInput();
    
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            currentUser = user;
            await loadUserData();
            await loadPosts();
            await loadSuggestedUsers();
            await loadNotifications();
            await loadTrendingTopics();
            await updateOnlineStatus(true);
            
            if (user.email === ADMIN_EMAIL) {
                document.getElementById('adminPanel').classList.add('visible');
                await loadAdminPanel();
            }
            
            // مستمع لحالة الاتصال
            setupPresence();
        } else {
            window.location.href = 'auth.html';
        }
    });
    
    // مستمع للبحث
    document.getElementById('searchInput').addEventListener('input', debounce(handleSearch, 300));
});

// ==========================================
// 1. عداد الأحرف
// ==========================================
function initCharCounter() {
    const postInput = document.getElementById('postContent');
    const counter = document.getElementById('charCounter');
    const submitBtn = document.getElementById('postSubmitBtn');
    
    postInput.addEventListener('input', function() {
        const len = this.value.length;
        counter.textContent = `${len}/280`;
        
        counter.classList.remove('warning', 'danger');
        if (len > 250) counter.classList.add('warning');
        if (len > 280) {
            counter.classList.add('danger');
            submitBtn.disabled = true;
        } else {
            submitBtn.disabled = false;
        }
        
        // كشف الروابط للمعاينة
        detectLinks(this.value);
    });
}

// ==========================================
// 2. كشف الروابط ومعاينتها
// ==========================================
function detectLinks(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = text.match(urlRegex);
    
    if (urls && urls.length > 0) {
        fetchLinkPreview(urls[0]);
    } else {
        document.getElementById('linkPreviewContainer').innerHTML = '';
    }
}

async function fetchLinkPreview(url) {
    try {
        // محاكاة جلب معاينة الرابط
        const container = document.getElementById('linkPreviewContainer');
        container.innerHTML = `
            <div class="link-preview">
                <div>
                    <div style="font-weight: bold;">🔗 ${new URL(url).hostname}</div>
                    <div style="color: var(--text-secondary); font-size: 14px;">معاينة الرابط</div>
                </div>
            </div>
        `;
    } catch (error) {
        console.error('Error fetching link preview:', error);
    }
}

// ==========================================
// 3. اختصارات لوحة المفاتيح
// ==========================================
function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // N: تغريدة جديدة
        if (e.key === 'n' && !e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault();
            document.getElementById('postContent').focus();
        }
        
        // /: بحث
        if (e.key === '/' && !e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault();
            document.getElementById('searchInput').focus();
        }
        
        // Ctrl+Enter: إرسال التغريدة
        if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            if (document.getElementById('postContent').value.trim()) {
                createPost();
            }
        }
        
        // ESC: إغلاق النوافذ
        if (e.key === 'Escape') {
            closeImageModal();
            document.getElementById('postContent').blur();
            document.getElementById('searchInput').blur();
        }
        
        // D: الوضع الليلي
        if (e.key === 'd' && e.ctrlKey) {
            e.preventDefault();
            toggleTheme();
        }
    });
}

// ==========================================
// 4. زر العودة للأعلى
// ==========================================
function initScrollTopButton() {
    const btn = document.getElementById('scrollTopBtn');
    
    window.addEventListener('scroll', () => {
        if (window.scrollY > 500) {
            btn.classList.add('visible');
        } else {
            btn.classList.remove('visible');
        }
    });
}

function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    showToast('تم العودة للأعلى', 'info');
}

// ==========================================
// 5. Skeleton Loading
// ==========================================
function showSkeletonLoading() {
    const container = document.getElementById('postsContainer');
    container.innerHTML = '';
    
    for (let i = 0; i < 3; i++) {
        const skeleton = document.createElement('div');
        skeleton.className = 'skeleton-post';
        skeleton.innerHTML = `
            <div class="skeleton-avatar"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line short"></div>
            <div style="clear: both;"></div>
        `;
        container.appendChild(skeleton);
    }
}

// ==========================================
// 6. تحميل المزيد من التغريدات
// ==========================================
async function loadMorePosts() {
    const btn = document.getElementById('loadMoreBtn');
    btn.textContent = 'جاري التحميل...';
    btn.disabled = true;
    
    await loadPosts(true);
    
    btn.textContent = 'تحميل المزيد من التغريدات';
    btn.disabled = false;
}

// ==========================================
// 7. الإشارات المرجعية (Bookmarks)
// ==========================================
async function bookmarkPost(postId) {
    if (!currentUser) return;
    
    try {
        const bookmarkRef = db.ref(`users/${currentUser.uid}/bookmarks/${postId}`);
        const snapshot = await bookmarkRef.once('value');
        
        if (snapshot.exists()) {
            await bookmarkRef.remove();
            showToast('تم إزالة التغريدة من المحفوظات', 'info');
        } else {
            await bookmarkRef.set({
                timestamp: Date.now()
            });
            showToast('تم حفظ التغريدة', 'success');
        }
        
        await loadPosts();
    } catch (error) {
        console.error('Error bookmarking post:', error);
        showToast('حدث خطأ', 'error');
    }
}

async function showBookmarks() {
    showToast('قسم المحفوظات قيد التطوير', 'info');
}

// ==========================================
// 8. نظام الإشعارات
// ==========================================
async function loadNotifications() {
    if (!currentUser) return;
    
    try {
        const notifRef = db.ref(`notifications/${currentUser.uid}`).orderByChild('timestamp').limitToLast(20);
        const snapshot = await notifRef.once('value');
        const notifs = snapshot.val();
        
        if (notifs) {
            const unreadCount = Object.values(notifs).filter(n => !n.read).length;
            updateNotificationBadge(unreadCount);
        }
    } catch (error) {
        console.error('Error loading notifications:', error);
    }
}

function updateNotificationBadge(count) {
    const badge = document.getElementById('notificationCount');
    if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.style.display = 'block';
    } else {
        badge.style.display = 'none';
    }
}

async function showNotifications() {
    if (!currentUser) return;
    
    try {
        const notifRef = db.ref(`notifications/${currentUser.uid}`).orderByChild('timestamp').limitToLast(50);
        const snapshot = await notifRef.once('value');
        const notifs = snapshot.val();
        
        let message = 'الإشعارات:\n\n';
        if (notifs) {
            const notifArray = Object.values(notifs).reverse();
            notifArray.slice(0, 10).forEach(n => {
                message += `• ${n.message}\n`;
            });
            
            // تحديث حالة القراءة
            for (const [id, notif] of Object.entries(notifs)) {
                if (!notif.read) {
                    await db.ref(`notifications/${currentUser.uid}/${id}`).update({ read: true });
                }
            }
            updateNotificationBadge(0);
        } else {
            message += 'لا توجد إشعارات جديدة';
        }
        
        alert(message);
    } catch (error) {
        console.error('Error showing notifications:', error);
    }
}

async function sendNotification(userId, message, type = 'info') {
    try {
        const notifRef = db.ref(`notifications/${userId}`).push();
        await notifRef.set({
            message: message,
            type: type,
            timestamp: Date.now(),
            read: false,
            from: currentUser.uid,
            fromName: currentUserData?.name || 'مستخدم'
        });
        
        // تشغيل صوت الإشعار
        playSound('notification');
    } catch (error) {
        console.error('Error sending notification:', error);
    }
}

// ==========================================
// 9. تأثيرات صوتية
// ==========================================
function playSound(action) {
    if (!currentUserData?.settings?.soundEffects) return;
    
    try {
        // محاكاة الأصوات (يمكن إضافة ملفات صوتية حقيقية)
        console.log('🔊 Playing sound:', action);
        
        // يمكن إضافة مكتبة Howler.js للأصوات الحقيقية
        // if (sounds[action]) {
        //     sounds[action].play();
        // }
    } catch (error) {
        console.error('Error playing sound:', error);
    }
}

// ==========================================
// 10. حالة الاتصال (Online Status)
// ==========================================
function setupPresence() {
    if (!currentUser) return;
    
    const userStatusRef = db.ref(`users/${currentUser.uid}`);
    const connectedRef = db.ref('.info/connected');
    
    connectedRef.on('value', (snap) => {
        if (snap.val() === true) {
            userStatusRef.update({ isOnline: true });
            
            userStatusRef.child('isOnline').onDisconnect().set(false);
            userStatusRef.child('lastSeen').onDisconnect().set(Date.now());
        }
    });
    
    // الاستماع لحالة المستخدمين الآخرين
    db.ref('users').on('child_changed', (snapshot) => {
        updateUserOnlineStatus(snapshot.key, snapshot.val().isOnline);
    });
}

async function updateOnlineStatus(isOnline) {
    if (!currentUser) return;
    
    try {
        await db.ref(`users/${currentUser.uid}`).update({
            isOnline: isOnline,
            lastSeen: Date.now()
        });
        
        document.getElementById('onlineIndicator').style.background = 
            isOnline ? 'var(--accent-green)' : 'var(--text-secondary)';
    } catch (error) {
        console.error('Error updating online status:', error);
    }
}

function updateUserOnlineStatus(userId, isOnline) {
    // تحديث مؤشر الاتصال للمستخدمين في القائمة
    const indicators = document.querySelectorAll(`[data-user-id="${userId}"] .online-indicator`);
    indicators.forEach(ind => {
        ind.style.background = isOnline ? 'var(--accent-green)' : 'var(--text-secondary)';
    });
}

// ==========================================
// 11. تنسيق الروابط والهاشتاغات
// ==========================================
function formatContent(text) {
    if (!text) return '';
    
    // تنسيق الهاشتاغات
    text = text.replace(/#(\w+)/g, '<a href="#" onclick="searchHashtag(\'$1\')" class="hashtag">#$1</a>');
    
    // تنسيق الإشارات
    text = text.replace(/@(\w+)/g, '<a href="#" onclick="viewUserProfile(\'$1\')">@$1</a>');
    
    // تنسيق الروابط
    text = text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
    
    return text;
}

function searchHashtag(tag) {
    document.getElementById('searchInput').value = '#' + tag;
    handleSearch();
    showToast(`البحث عن #${tag}`, 'info');
}

function viewUserProfile(username) {
    showToast(`الملف الشخصي لـ @${username}`, 'info');
}

// ==========================================
// 12. إعادة التغريد (Retweet)
// ==========================================
async function retweetPost(postId, withQuote = false) {
    if (!currentUser) return;
    
    if (withQuote) {
        // فتح نافذة الاقتباس
        const quote = prompt('أضف تعليقك على إعادة التغريد:');
        if (quote !== null) {
            await createRetweet(postId, quote);
        }
    } else {
        if (confirm('هل تريد إعادة تغريد هذا المنشور؟')) {
            await createRetweet(postId);
        }
    }
}

async function createRetweet(postId, quote = '') {
    try {
        const postRef = db.ref('posts/' + postId);
        const snapshot = await postRef.once('value');
        const originalPost = snapshot.val();
        
        const retweetData = {
            userId: currentUser.uid,
            content: quote,
            timestamp: Date.now(),
            originalPostId: postId,
            originalUserId: originalPost.userId,
            isRetweet: true,
            likes: {},
            comments: {}
        };
        
        await db.ref('posts').push(retweetData);
        
        // تحديث عداد إعادة التغريد
        await db.ref(`posts/${postId}/retweets/${currentUser.uid}`).set(true);
        
        // إرسال إشعار
        await sendNotification(originalPost.userId, `${currentUserData.name} أعاد تغريد منشورك`);
        
        playSound('retweet');
        showToast('تم إعادة التغريد بنجاح', 'success');
        await loadPosts();
    } catch (error) {
        console.error('Error creating retweet:', error);
        showToast('حدث خطأ في إعادة التغريد', 'error');
    }
}

// ==========================================
// 13. الاستطلاعات (Polls)
// ==========================================
function createPoll() {
    const question = prompt('أدخل سؤال الاستطلاع:');
    if (!question) return;
    
    const options = [];
    for (let i = 1; i <= 4; i++) {
        const option = prompt(`الخيار ${i} (اتركه فارغاً للإنهاء):`);
        if (!option) break;
        options.push(option);
    }
    
    if (options.length < 2) {
        showToast('يجب إدخال خيارين على الأقل', 'error');
        return;
    }
    
    const pollData = {
        question: question,
        options: options.reduce((acc, opt) => {
            acc[opt] = 0;
            return acc;
        }, {}),
        votes: {},
        duration: 24 * 60 * 60 * 1000 // 24 ساعة
    };
    
    // إضافة الاستطلاع إلى التغريدة الحالية
    const postContent = document.getElementById('postContent');
    postContent.value = `📊 استطلاع: ${question}\n` + 
        options.map((opt, i) => `${i+1}. ${opt}`).join('\n') + 
        '\n\nصوت الآن!';
    
    showToast('تم إنشاء الاستطلاع، أضف تعليقك ثم انشر', 'success');
}

// ==========================================
// 14. المواضيع الرائجة (Trending Topics)
// ==========================================
async function loadTrendingTopics() {
    try {
        const postsRef = db.ref('posts').orderByChild('timestamp').limitToLast(1000);
        const snapshot = await postsRef.once('value');
        const posts = snapshot.val();
        
        if (!posts) return;
        
        // استخراج الهاشتاغات
        const hashtags = {};
        Object.values(posts).forEach(post => {
            if (post.content) {
                const tags = post.content.match(/#(\w+)/g) || [];
                tags.forEach(tag => {
                    const cleanTag = tag.replace('#', '').toLowerCase();
                    hashtags[cleanTag] = (hashtags[cleanTag] || 0) + 1;
                });
            }
        });
        
        // ترتيب الهاشتاغات
        const sortedTags = Object.entries(hashtags)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
        
        const container = document.getElementById('trendingTopics');
        container.innerHTML = '';
        
        sortedTags.forEach(([tag, count]) => {
            const div = document.createElement('div');
            div.className = 'trending-item';
            div.onclick = () => searchHashtag(tag);
            div.innerHTML = `
                <div class="trending-topic">#${tag}</div>
                <div class="trending-count">${count} تغريدة</div>
            `;
            container.appendChild(div);
        });
    } catch (error) {
        console.error('Error loading trending topics:', error);
    }
}

// ==========================================
// 15. نسخ رابط التغريدة
// ==========================================
async function copyPostLink(postId) {
    const link = `${window.location.origin}/post/${postId}`;
    
    try {
        await navigator.clipboard.writeText(link);
        showToast('✅ تم نسخ الرابط إلى الحافظة', 'success');
        playSound('send');
    } catch (error) {
        // Fallback للمتصفحات القديمة
        const input = document.createElement('input');
        input.value = link;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        showToast('✅ تم نسخ الرابط', 'success');
    }
}

// ==========================================
// دوال Toast للإشعارات المنبثقة
// ==========================================
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = {
        success: '✅',
        error: '❌',
        info: 'ℹ️'
    };
    
    toast.innerHTML = `
        <span>${icons[type] || 'ℹ️'}</span>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            container.removeChild(toast);
        }, 300);
    }, 3000);
}

// ==========================================
// تبديل الوضع الليلي
// ==========================================
function toggleTheme() {
    isDarkMode = !isDarkMode;
    localStorage.setItem('darkMode', isDarkMode);
    applyTheme();
    showToast(isDarkMode ? '🌙 الوضع الليلي مفعل' : '☀️ الوضع النهاري مفعل', 'info');
}

function applyTheme() {
    const icon = document.getElementById('themeIcon');
    
    if (isDarkMode) {
        document.body.classList.add('dark-mode');
        if (icon) icon.className = 'fas fa-sun';
    } else {
        document.body.classList.remove('dark-mode');
        if (icon) icon.className = 'fas fa-moon';
    }
}

// ==========================================
// دوال مساعدة
// ==========================================
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function handleSearch() {
    const query = document.getElementById('searchInput').value.trim();
    if (query) {
        showToast(`البحث عن: ${query}`, 'info');
        // تنفيذ البحث
    }
}

function initImageInput() {
    document.getElementById('imageInput').addEventListener('change', handleImageUpload);
}

function closeImageModal() {
    document.getElementById('imageModal').classList.remove('active');
}

function viewImage(url) {
    const modal = document.getElementById('imageModal');
    const img = document.getElementById('modalImage');
    img.src = url;
    modal.classList.add('active');
}

function openSettings() {
    showToast('الإعدادات قيد التطوير', 'info');
}

function viewProfile() {
    showToast('الملف الشخصي قيد التطوير', 'info');
}

function showEmojiPicker() {
    showToast('😊 قسم الإيموجي قيد التطوير', 'info');
}

// ==========================================
// الدوال الأساسية (محتفظة بها من الكود الأصلي)
// ==========================================
async function loadUserData() {
    const userRef = db.ref('users/' + currentUser.uid);
    const snapshot = await userRef.once('value');
    currentUserData = snapshot.val();
    
    if (currentUserData) {
        document.getElementById('userDisplayName').textContent = currentUserData.name;
        const avatar = document.getElementById('userAvatar');
        avatar.textContent = currentUserData.name.charAt(0).toUpperCase();
        
        if (currentUserData.avatar) {
            avatar.style.backgroundImage = `url(${currentUserData.avatar})`;
            avatar.style.backgroundSize = 'cover';
            avatar.textContent = '';
        }
    }
}

async function loadPosts(loadMore = false) {
    if (!loadMore) {
        showSkeletonLoading();
    }
    
    try {
        let postsRef = db.ref('posts').orderByChild('timestamp');
        
        if (loadMore && lastLoadedPostKey) {
            postsRef = postsRef.endAt(null, lastLoadedPostKey);
        }
        
        postsRef = postsRef.limitToLast(postsPerPage);
        
        const snapshot = await postsRef.once('value');
        const posts = snapshot.val();
        
        const container = document.getElementById('postsContainer');
        
        if (!loadMore) {
            container.innerHTML = '';
        }
        
        if (!posts) {
            if (!loadMore) {
                container.innerHTML = '<div class="loading">لا توجد تغريدات بعد</div>';
            }
            document.getElementById('loadMoreBtn').style.display = 'none';
            return;
        }
        
        const postsArray = Object.entries(posts).reverse();
        
        if (!loadMore && postsArray.length > 0) {
            lastLoadedPostKey = postsArray[postsArray.length - 1][0];
        }
        
        for (const [postId, post] of postsArray) {
            if (post.isDeleted) continue;
            
            const userSnapshot = await db.ref('users/' + post.userId).once('value');
            const userData = userSnapshot.val();
            
            if (!userData || userData.isBanned) continue;
            
            const postElement = await createPostElement(postId, post, userData);
            container.appendChild(postElement);
        }
        
        // إظهار زر تحميل المزيد
        const totalPosts = Object.keys(posts).filter(id => !posts[id].isDeleted).length;
        document.getElementById('loadMoreBtn').style.display = 
            totalPosts >= postsPerPage ? 'block' : 'none';
            
    } catch (error) {
        console.error('Error loading posts:', error);
        showToast('حدث خطأ في تحميل التغريدات', 'error');
    }
}

async function createPostElement(postId, post, userData) {
    const div = document.createElement('div');
    div.className = 'post';
    div.dataset.postId = postId;
    div.dataset.userId = post.userId;
    
    // إذا كانت إعادة تغريد
    if (post.isRetweet && post.originalPostId) {
        return await createRetweetElement(postId, post, userData);
    }
    
    const formattedContent = formatContent(post.content || '');
    const likes = post.likes ? Object.keys(post.likes).length : 0;
    const comments = post.comments ? Object.keys(post.comments).length : 0;
    const retweets = post.retweets ? Object.keys(post.retweets).length : 0;
    const userLiked = post.likes && post.likes[currentUser?.uid];
    const userRetweeted = post.retweets && post.retweets[currentUser?.uid];
    const userBookmarked = currentUserData?.bookmarks && currentUserData.bookmarks[postId];
    
    let content = `
        <div class="post-header">
            <div class="post-avatar" onclick="viewProfile()">${userData.name.charAt(0).toUpperCase()}</div>
            <div style="flex: 1;">
                <span class="post-author" onclick="viewProfile()">${userData.name}</span>
                ${userData.isVerified ? '<i class="fas fa-check-circle verified-badge"></i>' : ''}
                <span class="post-username">@${userData.username}</span>
                <span style="color: var(--text-secondary);"> · ${formatTimestamp(post.timestamp)}</span>
                ${userData.isOnline ? '<span class="online-indicator" style="display: inline-block; position: static; margin-right: 5px;"></span>' : ''}
            </div>
            <i class="fas fa-ellipsis-h" style="color: var(--text-secondary); cursor: pointer;" onclick="showPostOptions('${postId}')"></i>
        </div>
        <div class="post-content">${formattedContent}</div>
    `;
    
    // إضافة الصور
    if (post.images && post.images.length > 0) {
        content += '<div class="post-images">';
        post.images.forEach(img => {
            content += `<img src="${img}" class="post-image" onclick="viewImage('${img}')">`;
        });
        content += '</div>';
    }
    
    // إضافة الصوت
    if (post.audio) {
        content += `<audio class="post-audio" controls src="${post.audio}"></audio>`;
    }
    
    // إضافة الاستطلاع
    if (post.poll) {
        content += createPollElement(postId, post.poll);
    }
    
    content += `
        <div class="post-footer">
            <div class="post-action" onclick="showComments('${postId}')">
                <i class="far fa-comment"></i>
                <span>${comments}</span>
            </div>
            <div class="post-action ${userRetweeted ? 'retweeted' : ''}" onclick="retweetPost('${postId}')">
                <i class="fas fa-retweet"></i>
                <span>${retweets}</span>
            </div>
            <div class="post-action ${userLiked ? 'liked' : ''}" onclick="likePost('${postId}')">
                <i class="far fa-heart"></i>
                <span>${likes}</span>
            </div>
            <div class="post-action ${userBookmarked ? 'bookmarked' : ''}" onclick="bookmarkPost('${postId}')">
                <i class="far fa-bookmark"></i>
            </div>
            <div class="post-action" onclick="copyPostLink('${postId}')">
                <i class="fas fa-link"></i>
            </div>
        </div>
    `;
    
    div.innerHTML = content;
    return div;
}

async function createRetweetElement(postId, post, userData) {
    // جلب بيانات المنشور الأصلي
    const originalSnapshot = await db.ref('posts/' + post.originalPostId).once('value');
    const originalPost = originalSnapshot.val();
    
    if (!originalPost) return document.createElement('div');
    
    const originalUserSnapshot = await db.ref('users/' + originalPost.userId).once('value');
    const originalUserData = originalUserSnapshot.val();
    
    const div = document.createElement('div');
    div.className = 'post';
    
    const formattedContent = formatContent(originalPost.content || '');
    
    div.innerHTML = `
        <div style="color: var(--text-secondary); margin-bottom: 10px;">
            <i class="fas fa-retweet"></i> ${userData.name} أعاد التغريد
        </div>
        <div class="post-header">
            <div class="post-avatar">${originalUserData.name.charAt(0).toUpperCase()}</div>
            <div>
                <span class="post-author">${originalUserData.name}</span>
                ${originalUserData.isVerified ? '<i class="fas fa-check-circle verified-badge"></i>' : ''}
                <span class="post-username">@${originalUserData.username}</span>
                <span style="color: var(--text-secondary);"> · ${formatTimestamp(originalPost.timestamp)}</span>
            </div>
        </div>
        <div class="post-content">${formattedContent}</div>
        ${post.content ? `<div style="margin-top: 10px; padding: 10px; background: var(--bg-primary); border-radius: 12px;">${formatContent(post.content)}</div>` : ''}
    `;
    
    return div;
}

function createPollElement(postId, poll) {
    const totalVotes = Object.values(poll.votes || {}).reduce((a, b) => a + b, 0);
    
    let html = '<div style="border: 1px solid var(--border-color); border-radius: 16px; padding: 15px; margin: 10px 0;">';
    html += `<div style="font-weight: bold; margin-bottom: 10px;">📊 ${poll.question}</div>`;
    
    for (const [option, votes] of Object.entries(poll.options)) {
        const percentage = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
        html += `
            <div style="margin-bottom: 10px;">
                <div style="display: flex; justify-content: space-between;">
                    <span>${option}</span>
                    <span>${percentage}% (${votes} صوت)</span>
                </div>
                <div style="background: var(--bg-primary); height: 8px; border-radius: 4px; margin-top: 5px;">
                    <div style="background: var(--accent-blue); width: ${percentage}%; height: 100%; border-radius: 4px;"></div>
                </div>
            </div>
        `;
    }
    
    html += `<div style="color: var(--text-secondary); font-size: 12px; margin-top: 10px;">${totalVotes} صوت</div>`;
    html += '</div>';
    
    return html;
}

async function likePost(postId) {
    if (!currentUser) return;
    
    try {
        const likeRef = db.ref(`posts/${postId}/likes/${currentUser.uid}`);
        const snapshot = await likeRef.once('value');
        
        if (snapshot.exists()) {
            await likeRef.remove();
        } else {
            await likeRef.set(true);
            playSound('like');
            
            // إرسال إشعار لصاحب المنشور
            const postSnapshot = await db.ref('posts/' + postId).once('value');
            const post = postSnapshot.val();
            if (post.userId !== currentUser.uid) {
                await sendNotification(post.userId, `${currentUserData.name} أعجب بتغريدتك`);
            }
        }
        
        // تحديث العرض فقط للمنشور المعني
        const postElement = document.querySelector(`[data-post-id="${postId}"]`);
        if (postElement) {
            const likeBtn = postElement.querySelector('.post-action .fa-heart').parentElement;
            const likeCount = postElement.querySelector('.post-action span');
            const currentLikes = parseInt(likeCount.textContent) || 0;
            
            if (snapshot.exists()) {
                likeBtn.classList.remove('liked');
                likeCount.textContent = currentLikes - 1;
            } else {
                likeBtn.classList.add('liked');
                likeCount.textContent = currentLikes + 1;
            }
        }
    } catch (error) {
        console.error('Error liking post:', error);
        showToast('حدث خطأ', 'error');
    }
}

function showComments(postId) {
    showToast('قسم التعليقات قيد التطوير', 'info');
}

function showPostOptions(postId) {
    const options = [
        'نسخ الرابط',
        'الإبلاغ عن تغريدة',
        currentUser?.uid === document.querySelector(`[data-post-id="${postId}"]`)?.dataset.userId ? 'حذف التغريدة' : null
    ].filter(Boolean);
    
    const choice = prompt('خيارات:\n' + options.map((o, i) => `${i+1}. ${o}`).join('\n'));
    
    if (choice === '1') copyPostLink(postId);
    if (choice === '2') showToast('تم الإبلاغ عن التغريدة', 'info');
    if (choice === '3') deletePost(postId);
}

async function deletePost(postId) {
    if (!confirm('هل أنت متأكد من حذف هذه التغريدة؟')) return;
    
    try {
        await db.ref(`posts/${postId}`).update({ isDeleted: true });
        showToast('تم حذف التغريدة', 'success');
        await loadPosts();
    } catch (error) {
        console.error('Error deleting post:', error);
        showToast('حدث خطأ في الحذف', 'error');
    }
}

async function createPost() {
    const content = document.getElementById('postContent').value.trim();
    
    if (!content && selectedImages.length === 0 && !audioBlob) {
        showToast('الرجاء كتابة نص أو إضافة صورة أو تسجيل صوت', 'error');
        return;
    }
    
    if (content.length > 280) {
        showToast('تجاوزت الحد المسموح 280 حرف', 'error');
        return;
    }
    
    const submitBtn = document.getElementById('postSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'جاري النشر...';
    
    try {
        const postData = {
            userId: currentUser.uid,
            content: content,
            timestamp: Date.now(),
            likes: {},
            comments: {},
            retweets: {},
            isDeleted: false
        };
        
        // رفع الصور
        if (selectedImages.length > 0) {
            postData.images = [];
            for (const image of selectedImages) {
                const imageUrl = await uploadToCloudinary(image);
                postData.images.push(imageUrl);
            }
        }
        
        // رفع الصوت
        if (audioBlob) {
            postData.audio = await uploadAudioToCloudinary(audioBlob);
        }
        
        await db.ref('posts').push(postData);
        
        playSound('send');
        showToast('تم نشر التغريدة بنجاح! 🎉', 'success');
        
        // إعادة تعيين النموذج
        document.getElementById('postContent').value = '';
        selectedImages = [];
        audioBlob = null;
        document.getElementById('imagePreview').innerHTML = '';
        document.getElementById('audioPreview').style.display = 'none';
        document.getElementById('charCounter').textContent = '0/280';
        document.getElementById('linkPreviewContainer').innerHTML = '';
        
        await loadPosts();
        await loadTrendingTopics();
    } catch (error) {
        console.error('Error creating post:', error);
        showToast('حدث خطأ أثناء إنشاء التغريدة', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'تغريد';
    }
}

// ==========================================
// دوال Cloudinary و Media
// ==========================================
function handleImageUpload(event) {
    const files = event.target.files;
    const preview = document.getElementById('imagePreview');
    
    for (const file of files) {
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                selectedImages.push(file);
                const img = document.createElement('img');
                img.src = e.target.result;
                img.className = 'preview-image';
                img.onclick = () => {
                    const index = selectedImages.indexOf(file);
                    if (index > -1) {
                        selectedImages.splice(index, 1);
                        img.remove();
                    }
                };
                preview.appendChild(img);
            };
            reader.readAsDataURL(file);
        }
    }
}

async function toggleRecording() {
    const btn = document.getElementById('recordBtn');
    
    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            
            mediaRecorder.ondataavailable = (event) => {
                audioChunks.push(event.data);
            };
            
            mediaRecorder.onstop = () => {
                audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                const audioUrl = URL.createObjectURL(audioBlob);
                const audioPreview = document.getElementById('audioPreview');
                audioPreview.src = audioUrl;
                audioPreview.style.display = 'block';
            };
            
            mediaRecorder.start();
            isRecording = true;
            btn.classList.add('recording');
            btn.innerHTML = '<i class="fas fa-stop"></i> إيقاف';
            showToast('🎤 بدأ التسجيل الصوتي', 'info');
        } catch (error) {
            showToast('لا يمكن الوصول إلى الميكروفون', 'error');
        }
    } else {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
        isRecording = false;
        btn.classList.remove('recording');
        btn.innerHTML = '<i class="fas fa-microphone"></i>';
        showToast('✅ تم إيقاف التسجيل', 'success');
    }
}

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

// ==========================================
// دوال المتابعة والمستخدمين
// ==========================================
async function loadSuggestedUsers() {
    const usersRef = db.ref('users');
    const snapshot = await usersRef.once('value');
    const users = snapshot.val();
    
    const container = document.getElementById('suggestedUsers');
    container.innerHTML = '';
    
    if (!users || !currentUserData) return;
    
    const following = currentUserData.following || {};
    let count = 0;
    
    for (const [userId, userData] of Object.entries(users)) {
        if (userId === currentUser.uid || userData.isBanned || following[userId]) continue;
        if (count++ >= 5) break;
        
        const div = document.createElement('div');
        div.className = 'suggested-user';
        div.dataset.userId = userId;
        div.innerHTML = `
            <div>
                <strong>${userData.name}</strong>
                ${userData.isVerified ? '<i class="fas fa-check-circle verified-badge"></i>' : ''}
                <div style="color: var(--text-secondary);">@${userData.username}</div>
                ${userData.isOnline ? '<span style="color: var(--accent-green); font-size: 12px;">🟢 متصل الآن</span>' : ''}
            </div>
            <button class="follow-btn" onclick="followUser('${userId}')">متابعة</button>
        `;
        container.appendChild(div);
    }
}

async function followUser(userId) {
    try {
        const updates = {};
        updates[`users/${currentUser.uid}/following/${userId}`] = true;
        updates[`users/${userId}/followers/${currentUser.uid}`] = true;
        
        await db.ref().update(updates);
        
        // إرسال إشعار
        await sendNotification(userId, `${currentUserData.name} بدأ بمتابعتك`);
        
        showToast('تمت المتابعة بنجاح', 'success');
        await loadSuggestedUsers();
    } catch (error) {
        console.error('Error following user:', error);
        showToast('حدث خطأ في المتابعة', 'error');
    }
}

// ==========================================
// دوال لوحة تحكم المدير
// ==========================================
async function loadAdminPanel() {
    await loadUsersList();
    await loadContentList();
    await loadStats();
}

async function loadUsersList() {
    const usersRef = db.ref('users');
    const snapshot = await usersRef.once('value');
    const users = snapshot.val();
    
    const container = document.getElementById('usersList');
    container.innerHTML = '';
    
    for (const [userId, userData] of Object.entries(users)) {
        const div = document.createElement('div');
        div.className = 'user-management-item';
        div.innerHTML = `
            <div>
                <strong>${userData.name}</strong>
                ${userData.isVerified ? '<i class="fas fa-check-circle verified-badge"></i>' : ''}
                <div style="color: var(--text-secondary);">@${userData.username}</div>
                <div style="font-size: 12px;">${userData.email}</div>
            </div>
            <div>
                <button class="verify-btn" onclick="toggleVerifyUser('${userId}', ${!userData.isVerified})">
                    ${userData.isVerified ? 'إلغاء التوثيق' : 'توثيق'}
                </button>
                <button class="ban-btn" onclick="toggleBanUser('${userId}', ${!userData.isBanned})">
                    ${userData.isBanned ? 'إلغاء الحظر' : 'حظر'}
                </button>
            </div>
        `;
        container.appendChild(div);
    }
}

async function toggleVerifyUser(userId, verify) {
    await db.ref(`users/${userId}`).update({ isVerified: verify });
    await loadUsersList();
    showToast(verify ? 'تم توثيق المستخدم' : 'تم إلغاء التوثيق', 'success');
}

async function toggleBanUser(userId, ban) {
    await db.ref(`users/${userId}`).update({ isBanned: ban });
    await loadUsersList();
    showToast(ban ? 'تم حظر المستخدم' : 'تم إلغاء الحظر', 'success');
}

async function loadContentList() {
    const postsRef = db.ref('posts').orderByChild('timestamp').limitToLast(20);
    const snapshot = await postsRef.once('value');
    const posts = snapshot.val();
    
    const container = document.getElementById('contentList');
    container.innerHTML = '';
    
    if (!posts) return;
    
    for (const [postId, post] of Object.entries(posts).reverse()) {
        if (post.isDeleted) continue;
        
        const div = document.createElement('div');
        div.className = 'user-management-item';
        div.innerHTML = `
            <div style="flex: 1;">
                <div style="font-weight: bold;">${escapeHtml((post.content || '').substring(0, 50))}...</div>
                <div style="font-size: 12px; color: var(--text-secondary);">${formatTimestamp(post.timestamp)}</div>
            </div>
            <button class="delete-btn" onclick="adminDeletePost('${postId}')">حذف</button>
        `;
        container.appendChild(div);
    }
}

async function adminDeletePost(postId) {
    if (!confirm('هل أنت متأكد من حذف هذا المنشور؟')) return;
    await db.ref(`posts/${postId}`).update({ isDeleted: true });
    await loadContentList();
    await loadPosts();
    showToast('تم حذف المنشور', 'success');
}

async function loadStats() {
    const usersRef = db.ref('users');
    const postsRef = db.ref('posts');
    
    const usersSnapshot = await usersRef.once('value');
    const postsSnapshot = await postsRef.once('value');
    
    const users = usersSnapshot.val() || {};
    const posts = postsSnapshot.val() || {};
    
    const totalUsers = Object.keys(users).length;
    const totalPosts = Object.values(posts).filter(p => !p.isDeleted).length;
    const bannedUsers = Object.values(users).filter(u => u.isBanned).length;
    const onlineUsers = Object.values(users).filter(u => u.isOnline).length;
    
    const container = document.getElementById('statsPanel');
    container.innerHTML = `
        <div>👥 إجمالي المستخدمين: ${totalUsers}</div>
        <div>🟢 المستخدمين المتصلين: ${onlineUsers}</div>
        <div>📝 إجمالي التغريدات: ${totalPosts}</div>
        <div>🚫 المستخدمين المحظورين: ${bannedUsers}</div>
        <div>📅 آخر تحديث: ${new Date().toLocaleString('ar')}</div>
    `;
}

// ==========================================
// دوال مساعدة
// ==========================================
function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'الآن';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} د`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} س`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} يوم`;
    
    return date.toLocaleDateString('ar');
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==========================================
// تسجيل الخروج
// ==========================================
async function logout() {
    if (!confirm('هل أنت متأكد من تسجيل الخروج؟')) return;
    
    try {
        await updateOnlineStatus(false);
        await db.ref('users/' + currentUser.uid).update({ 
            isOnline: false,
            lastSeen: Date.now()
        });
        await auth.signOut();
        window.location.href = 'auth.html';
    } catch (error) {
        console.error('Error logging out:', error);
        showToast('حدث خطأ في تسجيل الخروج', 'error');
    }
}

// تأكيد الخروج من الصفحة
window.addEventListener('beforeunload', (e) => {
    const postContent = document.getElementById('postContent');
    if (postContent && postContent.value.trim()) {
        e.preventDefault();
        e.returnValue = 'لديك تغريدة غير منشورة!';
    }
    
    if (currentUser) {
        db.ref('users/' + currentUser.uid).update({ 
            isOnline: false,
            lastSeen: Date.now()
        });
    }
});

console.log("✅ X Platform with 15+ Features Ready!");
