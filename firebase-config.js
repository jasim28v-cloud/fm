// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyCT0GTVZSv3d48qP3_2auOtibkjD00cUMA",
    authDomain: "gomrka-420d0.firebaseapp.com",
    databaseURL: "https://gomrka-420d0-default-rtdb.firebaseio.com",
    projectId: "gomrka-420d0",
    storageBucket: "gomrka-420d0.firebasestorage.app",
    messagingSenderId: "581820766419",
    appId: "1:581820766419:web:b8f05224532782be5a5c26",
    measurementId: "G-61DFP9M8BQ"
};

// Agora Video Call Configuration
const AGORA_APP_ID = "b9e27270e1d74f7d9bcf8d18b9a1c3a4";

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();
const storage = firebase.storage();

// Cloudinary Configuration
const CLOUD_NAME = 'dmdrxi9xl';
const UPLOAD_PRESET = 'go_45xx';

// Admin Account
const ADMIN_EMAIL = 'jasim28v@gmail.com';

// إعدادات المستخدم الافتراضية
const DEFAULT_SETTINGS = {
    soundEffects: true,
    darkMode: false,
    notifications: true,
    language: 'ar'
};

console.log("✅ X Platform Ready with 15+ Features");
