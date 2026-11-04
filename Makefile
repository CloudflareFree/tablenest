.PHONY: build serve test
build:
	node scripts/build.mjs
serve:
	python3 -m http.server 8895 --bind 127.0.0.1
test:
	node --test test/workbench.test.mjs
