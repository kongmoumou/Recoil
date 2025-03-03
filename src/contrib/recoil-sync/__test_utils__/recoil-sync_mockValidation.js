/**
 * Copyright (c) Facebook, Inc. and its affiliates. Confidential and proprietary.
 *
 * @emails oncall+recoil
 * @flow strict-local
 * @format
 */
'use strict';

// TODO UPDATE IMPORTS TO USE PUBLIC INTERFACE
// TODO PUBLIC LOADABLE INTERFACE

import type {Loadable} from '../../../adt/Recoil_Loadable';

const {loadableWithValue} = require('../../../adt/Recoil_Loadable');

////////////////////////////
// Mock validation library
////////////////////////////
const validateAny = loadableWithValue;
const validateString = (x: mixed): ?Loadable<string> =>
  typeof x === 'string' ? loadableWithValue<string>(x) : null;
const validateNumber = (x: mixed): ?Loadable<number> =>
  typeof x === 'number' ? loadableWithValue<number>(x) : null;
function upgrade<From, To>(
  validate: mixed => ?Loadable<From>,
  upgrader: From => To,
): mixed => ?Loadable<To> {
  return x => validate(x)?.map(upgrader);
}

module.exports = {
  validateAny,
  validateString,
  validateNumber,
  upgrade,
};
