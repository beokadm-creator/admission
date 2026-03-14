# 🚀 대학교 행사 예약 시스템 배포 가이드

## 📋 배포 전 체크리스트

### **1. Firebase Config 설정**

```bash
# Firebase 프로젝트에 로그인
firebase login

# NHN Cloud AlimTalk 설정
firebase functions:config:set nhn.appkey="YOUR_APP_KEY"
firebase functions:config:set nhn.secretkey="YOUR_SECRET_KEY"
firebase functions:config:set nhn.sender_key="YOUR_SENDER_KEY"

# 설정 확인
firebase functions:config:get
```

### **2. Firestore Indexes 배포**

`firestore.indexes.json`에 다음 인덱스가 포함되어 있는지 확인:

```json
{
  "indexes": [
    {
      "collectionGroup": "alimtalkQueue",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "schoolId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "rateLimits",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "lastRequest", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "registrationMetrics",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "schoolId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "capacityAlerts",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "schoolId", "order": "ASCENDING" },
        { "fieldPath": "read", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "abTestMetrics",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "schoolId", "order": "ASCENDING" },
        { "fieldPath": "group", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

**인덱스 배포:**
```bash
firebase deploy --only firestore:indexes
```

### **3. 환경 변수 점검**

다음 환경 변수가 설정되어 있는지 확인:

- ✅ `nhn.appkey`
- ✅ `nhn.secretkey`
- ✅ `nhn.sender_key`

### **4. Cloud Functions 목록**

배포될 Cloud Functions 목록:

| 함수명 | 설명 | 스케줄 |
|-------|------|--------|
| `registerRegistration` | 메인 신청 처리 (트래픽 제어) | 2nd Gen |
| `processAlimTalkQueue` | AlimTalk 큐 처리 트리거 | 2nd Gen |
| `onRegistrationCreateQueued` | 신청 생성 시 큐 추가 | 2nd Gen |
| `autoAdvanceQueue` | 대기열 자동 진입 (매 30초) | Scheduled |
| `onSchoolUpdate` | 용량 알림 트리거 | 2nd Gen |
| `scheduledCleanup` | 오래된 데이터 정리 (매 60분) | Scheduled |
| `getSystemStats` | 실시간 시스템 통계 | 2nd Gen |
| `getABTestGroup` | A/B 테스트 그룹 할당 | 2nd Gen |
| `registerRegistrationWithAB` | A/B 테스트 신청 처리 | 2nd Gen |
| `getABTestResults` | A/B 테스트 결과 조회 | 2nd Gen |

---

## 🚀 배포 단계

### **Step 1: 빌드**

```bash
# 프로젝트 루트 디렉토리에서
npm run build

# TypeScript 컴파일 체크
npm run check

# ESLint 검사
npm run lint
```

### **Step 2: Functions 빌드**

```bash
cd functions
npm run build
cd ..
```

### **Step 3: 배포**

```bash
# 전체 배포 (권장)
firebase deploy

# 또는 순차적 배포 (권장)
# 1. Firestore Rules
firebase deploy --only firestore:rules

# 2. Firestore Indexes
firebase deploy --only firestore:indexes

# 3. Hosting (Frontend)
firebase deploy --only hosting

# 4. Cloud Functions (Backend)
firebase deploy --only functions
```

**배포 성공 시 출력 예시:**
```
✔ Deploy complete!

Project endpoint: https://project-id.web.app
Functions deploy complete:
  - registerRegistration (us-central1)
  - processAlimTalkQueue (us-central1)
  - onRegistrationCreateQueued (us-central1)
  - autoAdvanceQueue (us-central1)
  - onSchoolUpdate (us-central1)
  - scheduledCleanup (us-central1)
  - getSystemStats (us-central1)
  - getABTestGroup (us-central1)
  - registerRegistrationWithAB (us-central1)
  - getABTestResults (us-central1)
```

---

## 🔧 배포 후 설정

### **1. Realtime Database Security Rules**

`database.rules.json`에 다음 규칙이 있는지 확인:

```json
{
  "rules": {
    "queue": {
      "$schoolId": {
        ".read": true,
        ".write": "auth != null && root.child('admins').child(auth.uid).exists()"
      }
    }
  }
}
```

**Realtime Database 규칙 배포:**
```bash
firebase deploy --only database
```

### **2. Firestore Security Rules**

`firestore.rules`에 다음 규칙 확인:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Functionality
    
    // Schools collection
    match /schools/{schoolId} {
      allow read: if(request.auth != null && 
        (get(/databases/$(database)/documents/admins/$(request.auth.uid)).role == 'MASTER' ||
         (get(/databases/$(database)/documents/admins/$(request.auth.uid)).role == 'SCHOOL' && 
           get(/databases/$(database)/documents/admins/$(request.auth.uid)).assignedSchoolId == schoolId));
      
      allow write: if(request.auth != null && 
        (get(/databases/$(database)/documents/admins/$(request.auth.uid)).role == 'MASTER' ||
         (get(/databases/$(database)/documents/admins/$(request.auth.uid)).role == 'SCHOOL' && 
           get(/databases/$(database)/documents/admins/$(request.auth.uid)).assignedSchoolId == schoolId));
    }
    
    // Registrations
    match /schools/{schoolId}/registrations/{registrationId} {
      allow read: if(request.auth != null && 
        (get(/databases/$(database)/documents/admins/$(request.auth.uid)).role == 'MASTER' ||
         (get(/databases/$(database)/documents/admins/$(request.auth.uid)).role == 'SCHOOL' && 
           get(/databases/$(database)/documents/admins/$(request.auth.uid)).assignedSchoolId == schoolId));
      
      // Cloud Functions can write
      allow write: if(request.auth != null); // Functions run with service account
    }
    
    // Rate Limits (write only by Functions)
    match /rateLimits/{identifier} {
      allow read, write: if(false); // Functions only
    }
    
    // AlimTalk Queue (write only by Functions)
    match /alimtalkQueue/{queueId} {
      allow read, write: if(false); // Functions only
    }
    
    // Registration Metrics (write only by Functions)
    match /registrationMetrics/{metricId} {
      allow read, write: if(false); // Functions only
    }
    
    // Capacity Alerts (read/write by admins)
    match /capacityAlerts/{alertId} {
      allow read, write: if(request.auth != null && 
        get(/databases/$(database)/documents/admins/$(request.auth.uid)).role in ['MASTER', 'SCHOOL']);
    }
    
    // A/B Test Metrics (write only by Functions)
    match /abTestMetrics/{metricId} {
      allow read, write: if(false); // Functions only
    }
  }
}
```

**Firestore 규칙 배포:**
```bash
firebase deploy --only firestore:rules
```

---

## ✅ 배포 후 검증

### **1. Firebase Console 확인**

**a) Cloud Functions:**
1. Firebase Console → Functions → 함수 목록 확인
2. 각 함수의 "Logs" 탭에서 에러 없는지 확인
3. "Metrics" 탭에서 호출 횟수 모니터링

**b) Firestore:**
1. Firestore → Collections → 다음 컬렉션 확인:
   - `schools`
   - `admins`
   - `alimtalkQueue` (자동 생성)
   - `rateLimits` (자동 생성)
   - `registrationMetrics` (자동 생성)
   - `capacityAlerts` (자동 생성)
   - `abTestMetrics` (자동 생성)

**c) Realtime Database:**
1. Realtime Database → Data → `queue/{schoolId}` 구조 확인

**d) Hosting:**
1. Hosting → URL 확인: `https://project-id.web.app`

### **2. 로컬 테스트**

```bash
# 로컬 에뮬레이터로 테스트
firebase emulators:start

# 별도 터미널에서 테스트
# Terminal 1: Functions 에뮬레이터
cd functions && npm run shell

# Terminal 2: Firestore 에뮬레이터
firebase emulators:start --only firestore
```

### **3. 알림톡 연동 테스트**

1. 학교 설정에서 AlimTalk 템플릿 코드 입력
2. 테스트 신청 진행
3. AlimTalk 발송 확인
4. 큐에 쌓인 항목 확인

---

## 🎯 배포 완료 후 작업

### **1. 관리자 계정 생성**

```javascript
// Firebase Console → Authentication → Add user
// 또는 Firebase CLI:
firebase auth:create
```

### **2. Admin 문서 생성**

```javascript
// Firestore → admins 컬렉션
{
  id: "admin_uid",  // Firebase Auth UID
  email: "admin@example.com",
  role: "MASTER",  // MASTER 또는 SCHOOL
  assignedSchoolId: "school123",  // SCHOOL인 경우 필수
  name: "관리자 이름",
  createdAt: 1740865200000
}
```

### **3. School 설정**

1. 관리자로 로그인
2. `/admin/schools` 접속
3. 학교 추가/설정
4. AlimTalk 템플릿 설정
5. 정원 설정 (maxCapacity, waitlistCapacity)
6. A/B 테스트 설정 (선택사항)

---

## 🐛 문제 해결

### **문제 1: Index 생성 실패**

**에러:**
```
Error: 7 permission denied. 
```

**해결:**
```bash
# Firestore Indexes 재배포
firebase deploy --only firestore:indexes

# Console에서 수동으로 인덱스 생성
# Firestore → Indices → Create Index
```

### **문제 2: Functions 배포 실패**

**에러:**
```
Error: Functions deploy had errors
```

**해결:**
```bash
# Functions 빌드 확인
cd functions
npm run build

# 배포 재시도
cd ..
firebase deploy --only functions
```

### **문제 3: AlimTalk 발송 안됨**

**확인 사항:**
1. NHN Cloud Config 확인
2. Sender Key 확인
3. 템플릿 코드 확인
4. Cloud Functions 로그 확인

**로그 확인:**
```bash
firebase functions:log
```

---

## 📊 모니터링 설정

### **Cloud Functions 모니터링**

```bash
# 실시간 로그 보기
firebase functions:log --only registerRegistration

# 최근 100줄 로그
firebase functions:log --limit 100
```

### **Google Cloud Console**

1. Cloud Logging → Logs Explorer
2. 리소스: Cloud Functions
3. 필터: Function name, Severity
4. 알림 설정: Sink 생성하여 이메일/Slack 알림

---

## 🔒 보안 체크리스트

### **1. 인증**
- ✅ Admin 계정 강력한 비밀번호
- ✅ 2단계 인증 고려
- ✅ 만료된 세션 자동 로그아웃

### **2. 데이터 검증**
- ✅ 모든 입력 폼 검증
- ✅ Phone 포맷 검사 (010-0000-0000)
- ✅ 중복 신청 방지

### **3. Rate Limiting**
- ✅ 1분당 5회 제한
- ✅ IP 기반 추적
- ✅ Cloud Functions 보호

### **4. Firestore 보안**
- ✅ 인증된 사용자만 접근
- ✅ 역할 기반 접근 제어 (MASTER/SCHOOL)
- ✥ Admin만 쓰기 가능

---

## 📱 배포 후 사용자 가이드

### **관리자용**
1. `https://project-id.web.app/admin` 접속
2. Google 로그인
3. 학교 설정 관리
4. 실시간 모니터링 대시보드 확인
5. A/B 테스트 결과 분석

### **사용자용**
1. `https://project-id.web.app/{schoolId}` 접속
2. 대기열 시스템 안내
3. 번호표 발급
4. 입장 시 신청 페이지 이동
5. 신청 완료 후 AlimTalk 수신

---

## 🎉 배포 성공 확인

다음 기능이 정상 작동하는지 확인:

1. ✅ 사용자가 대기열 접속
2. ✅ 번호표 발급
3. ✅ 입장 가능 시 sessionToken 생성
4. ✅ 신청 페이지 접속 가능
5. ✅ 신청 완료 후 Firestore 저장
6. ✅ AlimTalk 발송
7. ✅ 관리자 대시보드 실시간 갱신
8. ✅ 용량 알림 작동
9. ✅ 대기열 자동 진입
10. ✅ A/B 테스트 데이터 수집

모두 완료되면 배포 성공! 🎉
