/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Link previews need an absolute image URL. When SITE_URL is set at build time
 * (the deploy workflow sets it), the preview image tags are added to the page.
 */
function socialImage(): Plugin {
  return {
    name: 'social-image',
    transformIndexHtml(html) {
      const site = process.env.SITE_URL?.replace(/\/?$/, '/');
      if (!site) return html.replace('<!-- social-image -->', '');
      const image = `${site}og-image.png`;
      return html.replace(
        '<!-- social-image -->',
        [
          `<meta property="og:url" content="${site}" />`,
          `<meta property="og:image" content="${image}" />`,
          '<meta property="og:image:width" content="1200" />',
          '<meta property="og:image:height" content="630" />',
          `<meta name="twitter:image" content="${image}" />`,
        ].join('\n    '),
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), socialImage()],
  // Relative asset paths, so the build works from any folder or sub-path.
  base: './',
  test: {
    include: ['src/**/*.test.ts'],
  },
});
