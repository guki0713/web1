/* 오프라인 지원.
 *
 * 앱 전체가 index.html 한 파일이므로 캐시할 것도 그 하나뿐이다.
 * 설치 시 받아 두고, 이후에는 캐시에서 먼저 띄운다(지하·비행기 모드에서도 열림).
 * 동시에 뒤에서 새 버전을 받아 두므로, 다음에 열 때 최신이 적용된다.
 *
 * CACHE 이름의 해시는 빌드(tools/build_single_file.py)가 index.html 내용에서
 * 자동으로 갱신한다. 내용이 바뀌면 이름이 바뀌고, 옛 캐시는 activate에서 지워진다.
 */
const CACHE = "workout-81d1a46b142d";
const ASSETS = ["./", "./index.html"];

self.addEventListener("install", ev => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", ev => {
  ev.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", ev => {
  const req = ev.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  ev.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      const fresh = fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);          // 오프라인이면 캐시본으로 버틴다
      return hit || fresh;
    })
  );
});
