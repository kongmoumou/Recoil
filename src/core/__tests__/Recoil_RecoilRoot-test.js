/**
 * Copyright (c) Facebook, Inc. and its affiliates. Confidential and proprietary.
 *
 * @emails oncall+recoil
 * @flow strict-local
 * @format
 */
'use strict';

import type {Store} from '../Recoil_State';

const {getRecoilTestFn} = require('../../__test_utils__/Recoil_TestingUtils');

let React,
  useState,
  ReactDOM,
  act,
  useSetRecoilState,
  atom,
  constSelector,
  selector,
  ReadsAtom,
  componentThatReadsAndWritesAtom,
  renderElements,
  RecoilRoot,
  useStoreRef;

const testRecoil = getRecoilTestFn(() => {
  React = require('react');
  ({useState} = require('react'));
  ReactDOM = require('ReactDOMLegacy_DEPRECATED');
  ({act} = require('ReactTestUtils'));

  ({useSetRecoilState} = require('../../hooks/Recoil_Hooks'));
  atom = require('../../recoil_values/Recoil_atom');
  constSelector = require('../../recoil_values/Recoil_constSelector');
  selector = require('../../recoil_values/Recoil_selector');
  ({
    ReadsAtom,
    componentThatReadsAndWritesAtom,
    renderElements,
  } = require('../../__test_utils__/Recoil_TestingUtils'));
  ({RecoilRoot} = require('../Recoil_RecoilRoot.react'));
  ({useStoreRef} = require('../Recoil_RecoilRoot.react'));
});

describe('initializeState', () => {
  testRecoil('initialize atom', () => {
    const myAtom = atom({
      key: 'RecoilRoot - initializeState - atom',
      default: 'DEFAULT',
    });
    // $FlowFixMe[incompatible-call] added when improving typing for this parameters
    const mySelector = constSelector(myAtom);

    function initializeState({set, getLoadable}) {
      expect(getLoadable(myAtom).contents).toEqual('DEFAULT');
      expect(getLoadable(mySelector).contents).toEqual('DEFAULT');
      set(myAtom, 'INITIALIZE');
      expect(getLoadable(myAtom).contents).toEqual('INITIALIZE');
      expect(getLoadable(mySelector).contents).toEqual('INITIALIZE');
    }

    const container = document.createElement('div');
    act(() => {
      ReactDOM.render(
        <RecoilRoot initializeState={initializeState}>
          <ReadsAtom atom={myAtom} />
          <ReadsAtom atom={mySelector} />
        </RecoilRoot>,
        container,
      );
    });

    expect(container.textContent).toEqual('"INITIALIZE""INITIALIZE"');
  });

  testRecoil('initialize selector', () => {
    const myAtom = atom({
      key: 'RecoilRoot - initializeState - selector',
      default: 'DEFAULT',
    });
    const mySelector = selector({
      key: 'RecoilRoot - initializeState - selector selector',
      get: ({get}) => get(myAtom),
      set: ({set}, newValue) => set(myAtom, newValue),
    });

    function initializeState({set, getLoadable}) {
      expect(getLoadable(myAtom).contents).toEqual('DEFAULT');
      expect(getLoadable(mySelector).contents).toEqual('DEFAULT');
      set(mySelector, 'INITIALIZE');
      expect(getLoadable(myAtom).contents).toEqual('INITIALIZE');
      expect(getLoadable(mySelector).contents).toEqual('INITIALIZE');
    }

    const container = document.createElement('div');
    act(() => {
      ReactDOM.render(
        <RecoilRoot initializeState={initializeState}>
          <ReadsAtom atom={myAtom} />
          <ReadsAtom atom={mySelector} />
        </RecoilRoot>,
        container,
      );
    });

    expect(container.textContent).toEqual('"INITIALIZE""INITIALIZE"');
  });

  testRecoil('Atom Effects run with global initialization', () => {
    let effectRan = 0;
    const myAtom = atom<string>({
      key: 'RecoilRoot - initializeState - atom effects',
      default: 'DEFAULT',
      effects_UNSTABLE: [
        ({setSelf}) => {
          effectRan++;
          setSelf(current => {
            // Effects are run first.
            expect(current).toEqual('DEFAULT');
            return 'EFFECT';
          });
        },
      ],
    });

    function initializeState({set}) {
      set(myAtom, current => {
        // Effects are run first, initializeState() takes precedence
        expect(current).toEqual('EFFECT');
        return 'INITIALIZE';
      });
    }

    expect(effectRan).toEqual(0);

    const container1 = document.createElement('div');
    act(() => {
      ReactDOM.render(
        <RecoilRoot initializeState={initializeState}>NO READ</RecoilRoot>,
        container1,
      );
    });
    // Effects are run when initialized with initializeState, even if not read.
    expect(container1.textContent).toEqual('NO READ');
    expect(effectRan).toEqual(1);

    const container2 = document.createElement('div');
    act(() => {
      ReactDOM.render(
        <RecoilRoot initializeState={initializeState}>
          <ReadsAtom atom={myAtom} />
        </RecoilRoot>,
        container2,
      );
    });

    // Effects are run first, initializeState() takes precedence
    expect(container2.textContent).toEqual('"INITIALIZE"');
    expect(effectRan).toEqual(2);
  });

  testRecoil('initialize with nested store', () => {
    const GetStore = ({children}: {children: Store => React.Node}) => {
      return children(useStoreRef().current);
    };

    const container = document.createElement('div');
    act(() => {
      ReactDOM.render(
        <RecoilRoot>
          <GetStore>
            {storeA => (
              <RecoilRoot store_INTERNAL={storeA}>
                <GetStore>
                  {storeB => {
                    expect(storeA === storeB).toBe(true);
                    return 'NESTED_ROOT/';
                  }}
                </GetStore>
              </RecoilRoot>
            )}
          </GetStore>
          ROOT
        </RecoilRoot>,
        container,
      );
    });

    expect(container.textContent).toEqual('NESTED_ROOT/ROOT');
  });
});

testRecoil(
  'Impure state updater functions that trigger atom updates are detected',
  () => {
    // This test ensures that we throw a clean error rather than mysterious breakage
    // if the user supplies a state updater function that triggers another update
    // within its execution. These state updater functions are supposed to be pure.
    // We can't detect all forms of impurity but this one in particular will make
    // Recoil break, so we detect it and throw an error.

    const atomA = atom({
      key: 'RecoilRoot/impureUpdater/a',
      default: 0,
    });
    const atomB = atom({
      key: 'RecoilRoot/impureUpdater/b',
      default: 0,
    });

    let update;
    function Component() {
      const updateA = useSetRecoilState(atomA);
      const updateB = useSetRecoilState(atomB);
      update = () => {
        updateA(() => {
          updateB(1);
          return 1;
        });
      };
      return null;
    }

    renderElements(<Component />);
    expect(() =>
      act(() => {
        update();
      }),
    ).toThrow('pure function');
  },
);

describe('override prop', () => {
  testRecoil(
    'RecoilRoots create a new Recoil scope when override is true or undefined',
    () => {
      const myAtom = atom({
        key: 'RecoilRoot/override/atom',
        default: 'DEFAULT',
      });

      const [ReadsWritesAtom, setAtom] = componentThatReadsAndWritesAtom(
        myAtom,
      );

      const container = renderElements(
        <RecoilRoot>
          <ReadsAtom atom={myAtom} />
          <RecoilRoot>
            <ReadsWritesAtom />
          </RecoilRoot>
        </RecoilRoot>,
      );

      expect(container.textContent).toEqual('"DEFAULT""DEFAULT"');

      act(() => setAtom('SET'));
      expect(container.textContent).toEqual('"DEFAULT""SET"');
    },
  );

  testRecoil(
    'A RecoilRoot performs no function if override is false and it has an ancestor RecoilRoot',
    () => {
      const myAtom = atom({
        key: 'RecoilRoot/override/atom',
        default: 'DEFAULT',
      });

      const [ReadsWritesAtom, setAtom] = componentThatReadsAndWritesAtom(
        myAtom,
      );

      const container = renderElements(
        <RecoilRoot>
          <ReadsAtom atom={myAtom} />
          <RecoilRoot override={false}>
            <ReadsAtom atom={myAtom} />
            <RecoilRoot override={false}>
              <ReadsWritesAtom />
            </RecoilRoot>
          </RecoilRoot>
        </RecoilRoot>,
      );

      expect(container.textContent).toEqual('"DEFAULT""DEFAULT""DEFAULT"');

      act(() => setAtom('SET'));
      expect(container.textContent).toEqual('"SET""SET""SET"');
    },
  );

  testRecoil(
    'Unmounting a nested RecoilRoot with override set to false does not clean up ancestor Recoil atoms',
    () => {
      const myAtom = atom({
        key: 'RecoilRoot/override/atom',
        default: 'DEFAULT',
      });

      const [ReadsWritesAtom, setAtom] = componentThatReadsAndWritesAtom(
        myAtom,
      );

      let setRenderNestedRoot;
      const NestedRootContainer = () => {
        const [renderNestedRoot, _setRenderNestedRoot] = useState(true);
        setRenderNestedRoot = _setRenderNestedRoot;
        return (
          renderNestedRoot && (
            <RecoilRoot override={false}>
              <ReadsWritesAtom />
            </RecoilRoot>
          )
        );
      };

      const container = renderElements(
        <RecoilRoot>
          <ReadsAtom atom={myAtom} />
          <NestedRootContainer />
        </RecoilRoot>,
      );

      expect(container.textContent).toEqual('"DEFAULT""DEFAULT"');

      act(() => setAtom('SET'));
      act(() => setRenderNestedRoot(false));
      expect(container.textContent).toEqual('"SET"');
    },
  );

  testRecoil(
    'A RecoilRoot functions normally if override is false and it does not have an ancestor RecoilRoot',
    () => {
      const myAtom = atom({
        key: 'RecoilRoot/override/atom',
        default: 'DEFAULT',
      });

      const [ReadsWritesAtom, setAtom] = componentThatReadsAndWritesAtom(
        myAtom,
      );

      const container = renderElements(
        <RecoilRoot override={false}>
          <ReadsWritesAtom />
        </RecoilRoot>,
      );

      expect(container.textContent).toEqual('"DEFAULT"');

      act(() => setAtom('SET'));
      expect(container.textContent).toEqual('"SET"');
    },
  );
});
