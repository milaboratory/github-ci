import {expect, test} from '@jest/globals'
import {canonizeVersion, countOccurrences} from '../src/utils'

/*
 * canonizeVersion tests
 */

const correctVersionsTests = [
  {
    testName: 'only major',
    version: '1',
    expected: '1.0.0'
  },
  {
    testName: 'mayor + minor',
    version: '1.10',
    expected: '1.10.0'
  },
  {
    testName: 'already canonized',
    version: '1.24.5',
    expected: '1.24.5'
  }
]

correctVersionsTests.forEach(value => {
  test(value.testName, async () => {
    let v: string = canonizeVersion(value.version)
    expect(v).toBe(value.expected)
  })
})

const brokenVersionTests = [
  {
    testName: 'wrong delimiter',
    version: '1.1,0'
  },
  {
    testName: 'wrong symbol',
    version: '1.2a'
  },
  {
    testName: 'incomplete line',
    version: '1.'
  },
  {
    testName: 'too long',
    version: '1.2.3.4'
  }
]

brokenVersionTests.forEach(value => {
  test(value.testName, async () => {
    await expect(async () => {
      canonizeVersion(value.version)
    }).rejects.toThrow()
  })
})

/*
 * countOccurrences tests
 */

const countOccurrencesTests = [
  {
    testName: 'count occurrences in empty string',
    str: '',
    substr: 'a',
    expect: 0
  },
  {
    testName: 'count occurrences of empty target',
    str: '',
    substr: 'a',
    expect: 0
  },
  {
    testName: 'no occurrences',
    str: 'asdfqwiouhsqwiub123dasjio',
    substr: '\n',
    expect: 0
  },
  {
    testName: 'has occurrences at the start',
    str: 'asdfqwi o uhsqw iub12 3dsjio',
    substr: 'a',
    expect: 1
  },
  {
    testName: 'has occurrences at the end',
    str: 'asdfqwi o uhsqw iub12 3dsjio!',
    substr: 'o!',
    expect: 1
  },
  {
    testName: 'has occurrences in the middle',
    str: 'asdfqwi o uhsqw\niub12 3dsjio',
    substr: '\n',
    expect: 1
  },
  {
    testName: 'all occurrences found',
    str: 'asdfqwi o uhsqw iub12 3dsjio',
    substr: ' ',
    expect: 4
  },
  {
    testName: 'long pattern caught once',
    str: 'aaaaaa',
    substr: 'aaaa',
    expect: 1
  }
]

countOccurrencesTests.forEach(value => {
  test(value.testName, async () => {
    const cnt: number = countOccurrences(value.str, value.substr)
    expect(cnt).toBe(value.expect)
  })
})
