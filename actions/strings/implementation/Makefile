build:
	@echo "Compiling typescript..."
	@npm run -- tsc

format:
	@echo "Formatting files..."
	@npm run -- prettier --write '**/*.ts' >/dev/null

lint:
	@echo "Linting..."
	@npm run -- eslint src/**/*.ts

test:
	@echo "Runnging tests..."
	@npm test

pkg-%:
	@echo "Building package '$*'"
	@npm run -- ncc build lib/$*.js --source-map --out ../$*

release: build \
         format \
         lint \
         replace-prefixes \

all: release \
     test

# Action build targets
replace-prefixes: build \
                  pkg-replace-prefixes
