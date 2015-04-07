/** Top level comments shouldn’t be duplicated. */
module.exports = 'hello world';
var a = require('rjs-require');
module.exports = a;

module.exports = {
  hello: 'world'
};

var soup = require('alphabet');
require('novar');
window.init();
module.exports = soup.eatWith('spoon');
