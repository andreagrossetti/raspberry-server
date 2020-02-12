#!/bin/bash

SNAPSHOT=$1
SNAPSHOTS_DIR="/opt/eurotech/esf/user/snapshots/"

install_snapshot () {
    rm -rf $SNAPSHOTS_DIR/* 2> /dev/null
    cp $SNAPSHOT $SNAPSHOTS_DIR/snapshot_1.xml
}

install_snapshot
