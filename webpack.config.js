const path = require('path');
const ExtractTextPlugin = require('extract-text-webpack-plugin');

module.exports = {
  entry: './browser/main.js',
  output: {
    path: path.join(__dirname, 'browser/build'),
    filename: 'bundle.js'
  },
  module: {
    loaders: [{
      test: /\.css$/,
      loader: ExtractTextPlugin.extract('style-loader', 'css')
    }]
  },
  externals: [{'fs': 'null'}],
  plugins: [
    new ExtractTextPlugin('styles.css')
  ]
}
