# 나의 건강관리

React·Vinext와 Supabase를 사용하는 개인 건강관리 웹앱입니다.

## 실행 방법

필요 환경: Node.js 22.13 이상

```bash
npm ci
npm run dev
```

프로덕션 빌드는 `npm run build`로 확인합니다.

환경변수, 비밀번호, 인증 토큰과 실제 이용자의 개인정보는 저장소에 올리지 않습니다.

## 배포

이 저장소는 전체 애플리케이션 소스코드를 보관합니다. GitHub Pages는 정적 호스팅만 지원하므로, Pages 주소는 서버 기능이 배포된 운영 앱으로 연결됩니다.

- 운영 앱: https://my-health-care-bcmedcoophome.bcmedcoophome.chatgpt.site/

## 재택의료 방문상담 체크리스트

사회복지사가 방문 중 휴대폰으로 체크하면 구글 드라이브(시트 + 상담기록지 문서)로 바로 저장되는 별도 도구입니다. 설치 방법은 [`home-visit/README.md`](home-visit/README.md)를 보세요.

## 이력서 서식

[`resume/index.html`](resume/index.html)을 브라우저로 열면 바로 입력할 수 있는 A4 이력서 서식입니다. 인적사항·학력·경력·자격증·교육·어학·병역·자기소개 항목이 있고, 표마다 행을 추가할 수 있으며 "인쇄 / PDF 저장" 버튼으로 출력합니다. 입력 내용은 그 브라우저에만 저장됩니다. 같은 서식의 Word 파일은 [`resume/이력서.docx`](resume/이력서.docx)에 있습니다.
