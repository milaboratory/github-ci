import {expect, test} from '@jest/globals'
import * as utils from '../src/utils'
import {version} from 'milib'

const latestVersionTestMap: utils.versionsMap = {
  '0.1': version.parse('0.1'),
  '0.10.2': version.parse('0.10.2'),
  '0.17.1': version.parse('0.17.1'),
  'v0.18': version.parse('0.18'),
  '1.1': version.parse('1.1'),
  'v1.5': version.parse('1.5'),
  '1.4.2': version.parse('1.4.2'),
  'v1.4.2.1': version.parse('1.4.2.1'),
  '1.4.beta': version.parse('1.4.beta'),
}

test('Test getLatestVersionTag', async () => {
  const tag = utils.latestVersionTag(latestVersionTestMap)
  expect(tag).toBe('v1.5')
})
