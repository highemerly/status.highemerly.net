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

  // distDir は既定の .next のままにする。
  // out/ に向けると next dev と next build が同じ場所を奪い合い、
  // build を挟んだ瞬間に dev サーバーが chunk を見失って 500 になる。
  // output: 'export' の書き出し先は既定で out/ なので、指定しなくてよい。
}

module.exports = nextConfig
