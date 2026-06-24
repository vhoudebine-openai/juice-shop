/*
 * Copyright (c) 2014-2026 Bjoern Kimminich & the OWASP Juice Shop contributors.
 * SPDX-License-Identifier: MIT
 */

import { type Request, type Response } from 'express'

import * as models from '../models/index'
import * as utils from '../lib/utils'

export function lookupUserByEmail () {
  return async (req: Request, res: Response) => {
    const email = String(req.query.email ?? '')
    const [users] = await models.sequelize.query(`SELECT id, email, role FROM Users WHERE email = '${email}' AND deletedAt IS NULL`)

    res.json(utils.queryResultToJson(users))
  }
}
