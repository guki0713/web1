# 운동일지

근지구력·심폐지구력 훈련량을 주 단위로 관리하고, 퍼포먼스 변화를 객관적으로
확인하기 위한 웹앱. Apple Numbers로 연도별·월별 수기 관리하던 운동일지를 대체한다.

**앱 열기** → <https://guki0713.github.io/web1/>
휴대폰 브라우저의 "홈 화면에 추가"로 앱처럼 쓸 수 있고, 한 번 연 뒤에는
인터넷 없이도 열린다.

**📖 [종합 매뉴얼](workout/README.md)** — 사용법, 지표 읽는 법, 문제 해결,
그리고 기능을 직접 고치고 늘리는 방법까지.

---

기록은 브라우저 안에만 저장되며 서버로 전송되지 않고 저장소에도 커밋하지 않는다.
기기 간 이동과 백업은 앱의 **데이터** 탭에서 JSON 내보내기/가져오기로 한다.

```
workout/index.html   배포용 단일 파일 (빌드 결과물)
workout/src/         편집용 원본 — 고칠 때는 여기를
tools/               .numbers 변환기, 단일 파일 빌드 스크립트
```

---

## 로컬에서 관리하기

이 저장소는 보통의 GitHub 저장소라 클라우드 세션 없이 내 컴퓨터에서 그대로
받아 고치고 올릴 수 있다. 필요한 건 `git`과 `python3`뿐이다.

```bash
git clone https://github.com/guki0713/web1.git
cd web1
```

### 고치고 확인하는 순서

```bash
# 1. workout/src/ 안의 파일을 고친다 (app.js, style.css, index.html)
python3 tools/build_single_file.py   # 2. src/ → workout/index.html 로 합친다
python3 tools/serve.py               # 3. http://localhost:8000 으로 미리 본다
```

`workout/index.html`을 브라우저로 그냥 열어도(`file://`) 대부분 동작하지만,
오프라인 지원(서비스 워커)은 http 주소에서만 등록된다. 제대로 확인하려면
`serve.py`로 띄워서 보는 편이 안전하다. 캐시를 꺼 두었으므로 새로고침하면
고친 내용이 바로 보인다.

확인이 끝나면 평소처럼 커밋하고 올린다.

```bash
git add -A
git commit -m "변경 내용"
git push
```

`master` 브랜치에 올라가면 GitHub Pages가 1~2분 뒤 반영한다.

**`workout/index.html`을 직접 고치지 말 것.** 빌드 결과물이라 다음 빌드에서
덮어써진다. 항상 `workout/src/`를 고치고 다시 빌드한다.

더 자세한 구조·기능 추가 방법은 **[종합 매뉴얼](workout/README.md)** 7~8장 참고.

