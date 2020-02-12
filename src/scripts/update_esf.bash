#!/bin/bash

OLD_ESF_RPM_PACKAGE=`rpm -qa | grep esf`
INSTALL_ESF=true
ESF_FILENAME=""
declare -a PACKAGES
DPA_FILE_PATH="/opt/eurotech/esf/data/dpa.properties"
SNAPSHOT=""
SNAPSHOTS_DIR="/opt/eurotech/esf/user/snapshots/"

while [[ $# -gt 0 ]]
do
    key="$1"

    case $key in
        -p|--package)
            PACKAGES=("$2" "${PACKAGES[@]}")
            shift # past argument
            shift # past value
        ;;
        -e|--esf-file-name)
            ESF_FILENAME="$2"
            shift # past argument
            shift # past value
        ;;
        -s|--snapshot)
            SNAPSHOT="$2"
            shift # past argument
            shift # past value
        ;;
    esac
done

turn_leds_on () {
    # Turn amber leds on
    echo 0 > /sys/class/leds/led1-green/brightness
    echo 0 > /sys/class/leds/led2-green/brightness
    echo 1 > /sys/class/leds/led1-amber/brightness
    echo 1 > /sys/class/leds/led2-amber/brightness
}

turn_leds_off () {
    # Turn amber leds on
    echo 0 > /sys/class/leds/led1-amber/brightness
    echo 0 > /sys/class/leds/led2-amber/brightness
}

install_packages () {
    rm $DPA_FILE_PATH 2> /dev/null
    touch $DPA_FILE_PATH
    mkdir /opt/eurotech/esf/data/packages
    for package in "${PACKAGES[@]}"; do
        package_name=`echo $package | sed  's/_.*//'`
        cp /tmp/$package /opt/eurotech/esf/data/packages/$package
        echo "$package_name=file\:/opt/eurotech/esf/data/packages/$package" >> $DPA_FILE_PATH
    done
}

install_snapshot () {
    rm -rf $SNAPSHOTS_DIR/* 2> /dev/null
    cp $SNAPSHOT $SNAPSHOTS_DIR/snapshot_1.xml
}

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
    # sudo reboot
}

turn_leds_on
remove_old_esf
if [ "$INSTALL_ESF" = true ] && [ ! -z "$ESF_FILENAME" ]; then
    install_esf
    install_packages
    install_snapshot
fi
install_snapshot
turn_leds_off
