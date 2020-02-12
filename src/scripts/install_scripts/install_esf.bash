#!/bin/bash

OLD_ESF_RPM_PACKAGE=`rpm -qa | grep esf`
ESF_FILENAME=$1

remove_old_esf () {
    if [ ! -z "$OLD_ESF_RPM_PACKAGE" ]; then
        # Remove rpm package
        rpm -e $OLD_ESF_RPM_PACKAGE 2> /dev/null
    fi
    # Remove old ESF files
    rm -fr /opt/eurotech/esf* 2> /dev/null
}

install_esf () {
    # Install ESF
    echo "Installing ESF"
    sudo rpm -ivh $ESF_FILENAME
}

remove_old_esf
install_esf
