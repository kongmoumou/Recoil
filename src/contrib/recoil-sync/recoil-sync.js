/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails oncall+recoil
 * @flow strict-local
 * @format
 */
'use strict';

// TODO UPDATE IMPORTS TO USE PUBLIC INTERFACE

import type {Loadable} from '../../adt/Recoil_Loadable';
import type {RecoilState} from '../../core/Recoil_RecoilValue';
import type {AtomEffect} from '../../recoil_values/Recoil_atom';

const {isLoadable} = require('../../adt/Recoil_Loadable');
const {DefaultValue} = require('../../core/Recoil_Node');
const {
  useRecoilSnapshot,
  useRecoilTransaction,
} = require('../../hooks/Recoil_Hooks');
const err = require('../../util/Recoil_err');
const {useCallback, useEffect} = require('react');

type NodeKey = string;
export type ItemKey = string;
export type SyncKey = string | void;

export type ItemDiff = Map<ItemKey, ?Loadable<mixed>>; // null means reset
export type ItemSnapshot = Map<ItemKey, ?Loadable<mixed>>; // null means default
export type ReadItem = ItemKey => ?Loadable<mixed>;
type WriteInterface = {diff: ItemDiff, allItems: ItemSnapshot};
export type WriteItems = WriteInterface => void;
export type ListenInterface = {
  updateItem: (ItemKey, ?Loadable<mixed>) => void,
  updateAllKnownItems: ItemSnapshot => void,
};
export type ListenToItems = ListenInterface => void | (() => void);
export type Restore<T> = mixed => ?Loadable<T>;

const DEFAULT_VALUE = new DefaultValue();

type AtomRegistration<T> = {
  atom: RecoilState<T>,
  itemKeys: Map<ItemKey, {restore: Restore<T>, syncDefault?: boolean}>,
  // In-flight updates to avoid feedback loops
  pendingUpdate?: {value: mixed | DefaultValue},
};

// TODO Scope this per <RecoilRoot>
class Registries {
  atomRegistries: Map<
    SyncKey,
    Map<NodeKey, AtomRegistration<any>>, // flowlint-line unclear-type:off
  > = new Map();

  getAtomRegistry(
    syncKey: SyncKey,
    // flowlint-next-line unclear-type:off
  ): Map<NodeKey, AtomRegistration<any>> {
    const registry = this.atomRegistries.get(syncKey);
    if (registry != null) {
      return registry;
    }
    const newRegistry = new Map();
    this.atomRegistries.set(syncKey, newRegistry);
    return newRegistry;
  }
}
const registries = new Registries();

type Storage = {
  write?: WriteItems,
  read?: ReadItem,
};
const storages: Map<SyncKey, Storage> = new Map();

const validateLoadable = <T>(
  loadable: Loadable<mixed>,
  {restore}: {restore: mixed => ?Loadable<T>, ...},
): Loadable<T | DefaultValue> =>
  loadable.map<mixed, T | DefaultValue>(x => restore(x) ?? new DefaultValue());

const itemsFromSnapshot = (syncKey, getInfo): ItemSnapshot => {
  const items: ItemSnapshot = new Map();
  for (const [, {atom, itemKeys}] of registries.getAtomRegistry(syncKey)) {
    // TODO syncEffect()'s write()
    for (const [itemKey, {syncDefault}] of itemKeys) {
      const atomInfo = getInfo(atom);
      items.set(
        itemKey,
        atomInfo.isSet || syncDefault === true ? atomInfo.loadable : null,
      );
    }
  }
  return items;
};

///////////////////////
// useRecoilSync()
///////////////////////
function useRecoilSync({
  syncKey,
  write,
  read,
  listen,
}: {
  syncKey?: SyncKey,
  write?: WriteItems,
  read?: ReadItem,
  listen?: ListenToItems,
}): void {
  // Subscribe to Recoil state changes
  const snapshot = useRecoilSnapshot();
  useEffect(() => {
    if (write != null) {
      const diff: ItemDiff = new Map();
      const atomRegistry = registries.getAtomRegistry(syncKey);
      const modifiedAtoms = snapshot.getNodes_UNSTABLE({isModified: true});
      for (const atom of modifiedAtoms) {
        const registration = atomRegistry.get(atom.key);
        if (registration != null) {
          const atomInfo = snapshot.getInfo_UNSTABLE(registration.atom);
          // Avoid feedback loops:
          // Don't write to storage updates that came from listening to storage
          if (
            !(
              (atomInfo.isSet &&
                atomInfo.loadable?.contents ===
                  registration.pendingUpdate?.value) ||
              (!atomInfo.isSet &&
                registration.pendingUpdate?.value instanceof DefaultValue)
            )
          ) {
            // TODO syncEffect()'s write()
            for (const [itemKey, {syncDefault}] of registration.itemKeys) {
              diff.set(
                itemKey,
                atomInfo.isSet || syncDefault === true
                  ? atomInfo.loadable
                  : null,
              );
            }
          }
          delete registration.pendingUpdate;
        }
      }
      // Lazy load "allItems" only if needed.
      const writeInterface = new Proxy(
        ({diff, allItems: (null: any)}: WriteInterface), // flowlint-line unclear-type:off
        {
          get: (target, prop) => {
            if (prop === 'allItems' && target.allItems == null) {
              target.allItems = itemsFromSnapshot(
                syncKey,
                snapshot.getInfo_UNSTABLE,
              );
            }
            return target[prop];
          },
        },
      );
      if (diff.size) {
        write(writeInterface);
      }
    }
  }, [snapshot, syncKey, write]);

  // Subscribe to Sync storage changes
  const updateItems = useRecoilTransaction(
    ({set, reset}) => (diff: ItemDiff) => {
      const atomRegistry = registries.getAtomRegistry(syncKey);
      for (const [, registration] of atomRegistry) {
        let resetAtom = false;
        // Go through registered item keys in reverse order so later syncEffects
        // take priority if multiple keys are specified for the same storage
        for (const [itemKey, cbs] of Array.from(
          registration.itemKeys,
        ).reverse()) {
          if (diff.has(itemKey)) {
            // null entry means to reset atom, but let's first check if there
            // is a fallback syncEffect for the same storage with another key
            // that may provide backup instructions.
            resetAtom = true;
          }
          const loadable = diff.get(itemKey);
          if (loadable != null) {
            resetAtom = false;
            const validated = validateLoadable(loadable, cbs);
            switch (validated.state) {
              case 'hasValue':
                registration.pendingUpdate = {
                  value: validated.contents,
                };
                set(registration.atom, validated.contents);
                break;
              case 'hasError':
                // TODO Async atom support to allow setting atom to error state
                // in the meantime we can just reset it to default value...
                registration.pendingUpdate = {value: DEFAULT_VALUE};
                reset(registration.atom);
                break;
              case 'loading':
                // TODO Async atom support
                throw err(
                  'Recoil does not yet support setting atoms to an asynchronous state',
                );
            }
            break;
          }
        }
        if (resetAtom) {
          registration.pendingUpdate = {value: DEFAULT_VALUE};
          reset(registration.atom);
        }
      }
    },
    [syncKey],
  );
  const updateItem = useCallback(
    (itemKey: ItemKey, loadable: ?Loadable<mixed>) => {
      updateItems(new Map([[itemKey, loadable]]));
    },
    [updateItems],
  );
  const updateAllKnownItems = useCallback(
    itemSnapshot => {
      // Reset the value of any items that are registered and not included in
      // the user-provided snapshot.
      const atomRegistry = registries.getAtomRegistry(syncKey);
      for (const [, registration] of atomRegistry) {
        for (const [itemKey] of registration.itemKeys) {
          if (!itemSnapshot.has(itemKey)) {
            itemSnapshot.set(itemKey);
          }
        }
      }
      updateItems(itemSnapshot);
    },
    [syncKey, updateItems],
  );
  useEffect(() => listen?.({updateItem, updateAllKnownItems}), [
    updateItem,
    updateAllKnownItems,
    listen,
  ]);

  // Register Storage
  // Save before effects so that we can initialize atoms for initial render
  storages.set(syncKey, {write, read});
  useEffect(() => () => void storages.delete(syncKey), [syncKey]);
}

///////////////////////
// syncEffect()
///////////////////////
export type SyncEffectOptions<T> = {
  syncKey?: SyncKey,
  key?: ItemKey,

  restore: mixed => ?Loadable<T>,

  read?: ({read: ReadItem}) => mixed,
  write?: (Loadable<T>, {read: ReadItem}) => ItemDiff,

  // Sync default value instead of empty when atom is indefault state
  syncDefault?: boolean,
};

function syncEffect<T>({
  syncKey,
  key,
  restore,
  syncDefault,
}: SyncEffectOptions<T>): AtomEffect<T> {
  return ({node, trigger, setSelf, getLoadable, getInfo_UNSTABLE}) => {
    const itemKey = key ?? node.key;

    // Register Atom
    const atomRegistry = registries.getAtomRegistry(syncKey);
    const registration = atomRegistry.get(node.key);
    registration != null
      ? registration.itemKeys.set(itemKey, {restore})
      : atomRegistry.set(node.key, {
          atom: node,
          itemKeys: new Map([[itemKey, {restore, syncDefault}]]),
        });

    if (trigger === 'get') {
      // Initialize Atom value
      const readFromStorage = storages.get(syncKey)?.read;
      if (readFromStorage != null) {
        const loadable = readFromStorage(itemKey);
        if (loadable != null) {
          if (!isLoadable(loadable)) {
            throw err('Sync read must provide a Loadable');
          }
          if (loadable.state === 'hasError') {
            throw loadable.contents;
          }

          const validated = validateLoadable<T>(loadable, {restore});
          switch (validated.state) {
            case 'hasValue':
              if (!(validated.contents instanceof DefaultValue)) {
                setSelf(validated.contents);
              }
              break;
            case 'hasError':
              throw validated.contents;
            case 'loading':
              setSelf(validated.toPromise());
              break;
          }
        }
      }

      // Persist on Initial Read
      const writeToStorage = storages.get(syncKey)?.write;
      if (syncDefault === true && writeToStorage != null) {
        setTimeout(() => {
          const loadable = getLoadable(node);
          if (loadable.state === 'hasValue') {
            // TODO Atom syncEffect() Write

            // Lazy load "allItems" only if needed.
            const writeInterface = new Proxy(
              ({
                diff: new Map([[itemKey, loadable]]),
                allItems: (null: any), // flowlint-line unclear-type:off
              }: WriteInterface),
              {
                get: (target, prop) => {
                  if (prop === 'allItems' && target.allItems == null) {
                    target.allItems = itemsFromSnapshot(
                      syncKey,
                      getInfo_UNSTABLE,
                    );
                  }
                  return target[prop];
                },
              },
            );

            writeToStorage(writeInterface);
          }
        }, 0);
      }
    }

    // Unregister atom
    return () => {
      atomRegistry.delete(node.key);
    };
  };
}

module.exports = {
  useRecoilSync,
  syncEffect,
};
