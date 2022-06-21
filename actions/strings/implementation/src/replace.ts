import * as core from '@actions/core'

export class Rule {
  re: RegExp
  replace: string

  constructor(src: RegExp, target: string) {
    this.re = src
    this.replace = target
  }

  static parse(ruleStr: string): Rule {
    const rule = ruleStr.split(' -> ', 2)
    if (rule.length < 2) {
      throw Error('wrong replace rule format')
    }

    const rePart = rule[0].replace('\\-\\>', '->')
    const match = new RegExp(rePart)
    const replacement = rule[1]
    return new Rule(match, replacement)
  }

  apply(str: string): [string, boolean] {
    const match = str.match(this.re) != null

    if (match) {
      str = str.replace(this.re, this.replace)
    }

    return [str, match]
  }
}

export class StringReplacer {
  rules: Rule[]

  constructor(rules: Rule[]) {
    this.rules = rules
  }

  static parse(rulesStr: string): StringReplacer {
    const rules: Rule[] = []
    for (const ruleLine of rulesStr.split('\n')) {
      if (ruleLine.trim().length === 0) {
        continue
      }
      rules.push(Rule.parse(ruleLine))
    }

    return new StringReplacer(rules)
  }

  apply(line: string): string {
    for (const rule of this.rules) {
      let match: boolean
      ;[line, match] = rule.apply(line)

      if (match) {
        break
      }
    }

    return line
  }
}

function replace(): void {
  // Read inputs
  const inputStr: string = core.getInput('input')
  const rulesStr: string = core.getInput('rules')

  const rules = StringReplacer.parse(rulesStr)

  const result: string[] = []
  for (const line of inputStr.split('\n')) {
    result.push(rules.apply(line))
  }

  core.setOutput('result', result.join('\n'))
}

function run(): void {
  try {
    replace()
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
      return
    }

    throw error
  }
}

run()
