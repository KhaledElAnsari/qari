import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import maleSound from '../../voices/male-sound.json' with { type: 'json' };
import femaleSound from '../../voices/female-sound.json' with { type: 'json' };

const FIXTURES = new URL('../fixtures/', import.meta.url);
const TEST_VOICE_BASE = '/test-voice/';

/** Serves the example configs, pointed at the tiny fixture models, and counts model downloads. */
async function serveTestVoices(context: BrowserContext, options: { missingModel?: boolean } = {}) {
  const modelRequests: string[] = [];
  const withTinyModels = (voice: typeof maleSound | typeof femaleSound) => ({
    ...voice,
    model: { url: 'tiny-acoustic.onnx', version: 'test-1' },
    vocoder: { url: 'tiny-vocoder.onnx', version: 'test-1' },
  });
  const files: Record<string, () => Promise<{ body: string | Buffer; contentType: string }>> = {
    'index.json': async () => ({ body: JSON.stringify(['male-sound.json', 'female-sound.json']), contentType: 'application/json' }),
    'male-sound.json': async () => ({ body: JSON.stringify(withTinyModels(maleSound)), contentType: 'application/json' }),
    'female-sound.json': async () => ({ body: JSON.stringify(withTinyModels(femaleSound)), contentType: 'application/json' }),
    'tiny-acoustic.onnx': async () => ({ body: await readFile(new URL('tiny-acoustic.onnx', FIXTURES)), contentType: 'application/octet-stream' }),
    'tiny-vocoder.onnx': async () => ({ body: await readFile(new URL('tiny-vocoder.onnx', FIXTURES)), contentType: 'application/octet-stream' }),
  };
  await context.route(url => url.pathname.startsWith(TEST_VOICE_BASE), async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    if (name.endsWith('.onnx') && route.request().method() === 'GET') modelRequests.push(name);
    const file = options.missingModel && name === 'tiny-acoustic.onnx' ? undefined : files[name];
    if (!file) return route.fulfill({ status: 404 });
    return route.fulfill({ status: 200, ...(await file()) });
  });
  return modelRequests;
}

// The demo shows one interface language at a time, picked from the browser's language: these tests run in an English
// browser (Playwright's default en-US), so they check the English text.
test.describe('Q1: load a voice, default or accelerated mode, synthesize in a Worker', () => {
  test('a headless browser with no real GPU reports accelerated mode as unavailable', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('probe')).toHaveText(/^unavailable \((no-webgpu-api|no-adapter|software-adapter|too-slow|probe-failed)/);
  });

  test('prepares Sami, plays a sentence, switches to Amal without downloading, and reads from the cache after reload', async ({ context, page }) => {
    const modelRequests = await serveTestVoices(context);
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto(`/?voice-base=${TEST_VOICE_BASE}`);
    await expect(page.getByRole('radio', { name: /Sami/ })).toBeChecked();
    await page.getByRole('button', { name: /Prepare audio/ }).click();
    await expect(page.getByTestId('stage')).toHaveText(/^Ready · Sami \(male\) · default mode/);
    expect(modelRequests.sort()).toEqual(['tiny-acoustic.onnx', 'tiny-vocoder.onnx']);

    await page.getByRole('button', { name: /Read/ }).click();
    await expect(page.getByTestId('log')).toContainText('first audio after');
    await expect(page.getByTestId('playback')).toHaveText('ready');

    // A change discards the audio; Prepare audio makes the new one, reusing the same model files (no download).
    await page.getByRole('radio', { name: /Amal/ }).check();
    await expect(page.getByTestId('stage')).toHaveText(/prepare the audio again/);
    await expect(page.getByRole('button', { name: /Read/ })).toBeDisabled();
    await page.getByRole('button', { name: /Prepare audio/ }).click();
    await expect(page.getByTestId('log')).toContainText('switched to nipponjo-female');
    await expect(page.getByTestId('stage')).toHaveText(/^Ready · Amal \(female\)/);
    expect(modelRequests).toHaveLength(2);

    await page.reload();
    await page.getByRole('button', { name: /Prepare audio/ }).click();
    await expect(page.getByTestId('stage')).toHaveText(/^Ready · Sami \(male\)/);
    expect(modelRequests).toHaveLength(2);

    await expect(page.getByTestId('log')).not.toContainText('error');
    await expect(page.getByTestId('log')).not.toContainText('has no "durations" output');
    await expect(page.getByTestId('message')).toBeHidden();
    expect(pageErrors).toEqual([]);
  });

  test('choosing accelerated mode where it can\'t run shows a plain message and keeps default mode working', async ({ context, page }) => {
    await serveTestVoices(context);
    await page.goto(`/?voice-base=${TEST_VOICE_BASE}`);
    await expect(page.getByTestId('probe')).toHaveText(/^unavailable/);
    await page.getByRole('button', { name: /Prepare audio/ }).click();
    await expect(page.getByTestId('stage')).toHaveText(/default mode/);

    await page.getByTestId('mode').click();
    await page.getByRole('option', { name: /accelerated mode/ }).click();
    await expect(page.getByRole('button', { name: /Read/ })).toBeDisabled();
    await page.getByRole('button', { name: /Prepare audio/ }).click();
    const message = page.getByTestId('message');
    await expect(message).toContainText('Accelerated mode doesn\'t work on this device. Use default mode.');
    await expect(message).not.toContainText(/webgpu|wasm|gpu|onnx/i);
    await expect(page.getByTestId('mode')).toContainText('default mode');
    await expect(page.getByTestId('stage')).toHaveText(/^Ready · Sami \(male\) · default mode/);

    await page.getByRole('button', { name: /Read/ }).click();
    await expect(page.getByTestId('log')).toContainText('first audio after');
  });

  test('a missing model file shows "voice unavailable" without technical details', async ({ context, page }) => {
    await serveTestVoices(context, { missingModel: true });
    await page.goto(`/?voice-base=${TEST_VOICE_BASE}`);
    await page.getByRole('button', { name: /Prepare audio/ }).click();
    const message = page.getByTestId('message');
    await expect(message).toContainText('This voice isn\'t available right now');
    await expect(message).not.toContainText(/http|404|onnx/i);
    await expect(page.getByTestId('log')).toContainText('error voice-unavailable: Model');
  });

  test('text with no Arabic letters says there is nothing to read', async ({ context, page }) => {
    await serveTestVoices(context);
    await page.goto(`/?voice-base=${TEST_VOICE_BASE}`);
    await page.getByRole('button', { name: /Prepare audio/ }).click();
    await expect(page.getByTestId('stage')).toHaveText(/^Ready/);
    await page.locator('#text').fill('MIT'); // No digits: numbers are read as words, so they count as text to read.
    await expect(page.getByRole('button', { name: /Read/ })).toBeDisabled();
    await page.getByRole('button', { name: /Prepare audio/ }).click();
    await expect(page.getByTestId('message')).toContainText('There\'s no text to read');
  });
});
