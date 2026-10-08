import { expect, test } from '@playwright/test';

interface IndexEntry { id: string; type: 'story' | 'docs'; title: string; name: string }

test('every story renders without errors and contacts no other host', async ({ page, request }) => {
  // One test walks all of them; the first visit also waits on Vite's dev compile.
  test.setTimeout(240_000);
  const index = (await (await request.get('/index.json')).json()) as { entries: Record<string, IndexEntry> };
  const stories = Object.values(index.entries).filter((e) => e.type === 'story');
  expect(stories.length).toBeGreaterThan(0);

  // Stopped before it is sent, not just noticed after: a request to a third
  // party has already said who is looking by the time it can be counted.
  const storybook = new URL(test.info().project.use.baseURL!).origin;
  const offMachine = new Set<string>();
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (new URL(url).origin === storybook) return route.continue();
    offMachine.add(url);
    return route.abort('blockedbyclient');
  });

  const broken: string[] = [];
  for (const story of stories) {
    const errors: string[] = [];
    const onError = (e: Error) => errors.push(e.message);
    // A request this test aborted logs its own console error; it is reported
    // once, below, as the URL it was — not 42 times as a broken story.
    const onConsole = (m: { type(): string; text(): string }) => {
      if (m.type() === 'error' && !m.text().includes('ERR_BLOCKED_BY_CLIENT')) errors.push(m.text());
    };
    page.on('pageerror', onError);
    page.on('console', onConsole);
    await page.goto(`/iframe.html?viewMode=story&id=${story.id}`);
    // Rendered, or Storybook's error screen — whichever comes first.
    await page.waitForFunction(() =>
      (document.querySelector('#storybook-root')?.childElementCount ?? 0) > 0
      || document.body.classList.contains('sb-show-errordisplay'));
    const errorShown = await page.evaluate(() => document.body.classList.contains('sb-show-errordisplay'));
    const rendered = await page.locator('#storybook-root').innerHTML();
    if (errorShown || rendered.length === 0 || errors.length > 0) {
      broken.push(`${story.title} › ${story.name}: ${errorShown ? 'error display' : rendered ? errors.join('; ') : 'nothing rendered'}`);
    }
    page.off('pageerror', onError);
    page.off('console', onConsole);
  }

  expect([...offMachine]).toEqual([]);
  expect(broken).toEqual([]);
});
