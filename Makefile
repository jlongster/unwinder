
test:
	node tests/run

bundle:
	browserify -e main -s main.js -o browser/probe.js
