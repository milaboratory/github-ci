import {expect, test} from '@jest/globals'
import * as replace from '../src/replace'

interface ruleParserTest {
  rule: string
  expectRE: RegExp
  expectReplace: string
  expectError: boolean
}

const ruleParserTests: ruleParserTest[] = [
  {
    rule: 'from1 -> to1',
    expectRE: new RegExp('from1'),
    expectReplace: 'to1',
    expectError: false
  },
  {
    rule: '^from2 -> ',
    expectRE: new RegExp('^from2'),
    expectReplace: '',
    expectError: false
  },
  {
    rule: 'from4 \\-\\>$ -> to4',
    expectRE: new RegExp('from4 ->$'),
    expectReplace: 'to4',
    expectError: false
  },
  {
    rule: ' -> invalid rule 1',
    expectRE: new RegExp(''),
    expectReplace: '',
    expectError: true
  },
  {
    rule: 'invalid rule 2',
    expectRE: new RegExp(''),
    expectReplace: '',
    expectError: true
  }
]

describe('Test rule parse', () => {
  test.each(ruleParserTests)(
    "parse '$rule'",
    async ({rule, expectRE, expectReplace, expectError}) => {
      const t = () => {
        const r = replace.Rule.parse(rule)

        expect(r.re).toEqual(expectRE)
        expect(r.replace).toBe(expectReplace)
      }

      if (expectError) {
        expect(t).toThrow(Error)
      } else {
        t()
      }
    }
  )
})

interface ruleApplyTest {
  rule: string
  sourceString: string
  expectedString: string
  expectReplaced: boolean
}

const ruleApplyTests: ruleApplyTest[] = [
  {
    rule: 'from1 -> to1',
    sourceString: 'begin from1 end',
    expectedString: 'begin to1 end',
    expectReplaced: true
  },
  {
    rule: 'from1 -> to1',
    sourceString: 'no text matches',
    expectedString: 'no text matches',
    expectReplaced: false
  },
  {
    rule: '^aaa -> bbb',
    sourceString: 'kkk aaa kkk',
    expectedString: 'kkk aaa kkk',
    expectReplaced: false
  },
  {
    rule: '^aaa -> bbb',
    sourceString: 'aaa ccc ddd',
    expectedString: 'bbb ccc ddd',
    expectReplaced: true
  }
]

describe('Test rule apply', () => {
  test.each(ruleApplyTests)(
    "apply '$rule' to '$sourceString'",
    async ({rule, sourceString, expectedString, expectReplaced}) => {
      const r = replace.Rule.parse(rule)
      const [result, replaced] = r.apply(sourceString)

      expect(result).toBe(expectedString)
      expect(replaced).toBe(expectReplaced)
    }
  )
})
