const assert = require('assert');

/**
 * Small adapter around Bun's test runner. Keeping suite construction local to
 * each file makes the domain tests easy to read while Bun owns scheduling and
 * reporting. Direct `bun path/to/test.js` execution keeps a sequential fallback.
 */
class TestSuite {
  constructor(name) {
    this.name = name;
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
    this.errors = [];
  }

  test(name, fn) {
    this.tests.push({ name, fn });
  }

  testAsync(name, fn) {
    this.tests.push({ name, fn });
  }

  async run() {
    // Under `bun test`, register each case with Bun's runner so async work is
    // actually awaited.
    if (typeof test === 'function') {
      for (const { name, fn } of this.tests) {
        test(`${this.name} > ${name}`, fn);
      }
      return 0;
    }

    this.passed = 0;
    this.failed = 0;
    this.errors = [];
    for (const { name, fn } of this.tests) {
      try {
        await fn();
        this.passed += 1;
        console.log(`  ✅ ${name}`);
      } catch (err) {
        this.failed += 1;
        this.errors.push({ name, err });
        console.log(`  ❌ ${name}: ${err.message}`);
      }
    }
    console.log(`\n  ${this.name}: ${this.passed} passed, ${this.failed} failed`);
    for (const { name, err } of this.errors) {
      console.log(`    ✗ ${name}: ${err.stack || err.message}`);
    }
    return this.failed;
  }
}

module.exports = { TestSuite, assert };
