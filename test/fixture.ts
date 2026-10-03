export const FIXED_DOM = `
<div id="root" class="wrap main">
  <header>
    <h1 class="title">标题</h1>
    <a href="/top" data-tags="alpha, beta">顶部链接</a>
  </header>
  <ul class="list outer">
    <li class="row">
      一层
      <ul class="list inner">
        <li class="row">
          二层
          <a href="/deep" class="link special">深层链接</a>
        </li>
      </ul>
    </li>
    <li class="row"><a href="/shallow" class="link">浅层链接</a></li>
  </ul>
  <a href="/solo" class="link special">独立链接</a>
</div>`;

export function pathsOf<T extends { path: string }>(hits: T[]): string[] {
  return hits.map((hit) => hit.path);
}
