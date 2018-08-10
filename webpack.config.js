const path = require('path');
const ExtractTextPlugin = require('extract-text-webpack-plugin');

module.exports = {
  entry: './browser/main.js',
  output: {
    path: path.join(__dirname, 'browser/build'),
    filename: 'bundle.js'
  },
  module: {
    rules: [{
      test: /\.css$/,
      use: ExtractTextPlugin.extract({
        fallback: 'style-loader',
        use: 'css-loader'
      })
    }],
  },
  externals: [{'fs': 'null'}],
  plugins: [
    new ExtractTextPlugin('styles.css')
  ]
}
