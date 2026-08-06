/** @type {import('next').NextConfig} */
const nextConfig = {
  // 静的エクスポート
  output: 'export',

  // Trailing slash
  trailingSlash: true,

  // 画像最適化を無効化（静的エクスポート時）
  images: {
    unoptimized: true,
  },

  // 出力ディレクトリ
  distDir: 'out',
}

module.exports = nextConfig
