import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReleaseNotes } from './ReleaseNotes';
import { compareVersions } from '../lib/version';

describe('release notes in the app', () => {
  it('shows the changelog part, not the download instructions', () => {
    const html = renderToStaticMarkup(<ReleaseNotes notes={'Android app, version 1.1.0. Tap **VolleyIQ.apk**.\n\n## What\'s new since v1.0.0\n\n**Voice tagging**\n- Say `7 pass 2`, it becomes **tags**.\n- In German too.\n\nPlain line.'} />);
    expect(html).not.toContain('Android app, version');
    expect(html).toContain("<h3>What&#x27;s new since v1.0.0</h3>");
    expect(html).toContain('<h4>Voice tagging</h4>');
    expect(html).toContain('<li>Say <code>7 pass 2</code>, it becomes <b>tags</b>.</li>');
    expect(html).toContain('<p>Plain line.</p>');
  });

  it('a release is newer than the test builds before it, and older than those after it', () => {
    expect(compareVersions('1.1.0', '1.0.1-dev.155')).toBeGreaterThan(0);
    expect(compareVersions('1.1.1-dev.160', '1.1.0')).toBeGreaterThan(0);
  });
});
