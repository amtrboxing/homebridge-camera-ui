'use-strict';

const { Logger } = require('../../services/logger/logger.service');

class Handler {
  constructor(hap, cameraUi) {
    this.hap = hap;
    this.log = Logger.log;
    this.cameraUi = cameraUi;

    this.motionTimers = new Map();
    this.doorbellTimers = new Map();

    //handle motion from mqtt/http/smtp/videoanalysis (passed through camera.ui)
    this.cameraUi.on('motion', (cameraName, trigger, state) => {
      this.handle(trigger, cameraName, state);
    });

    this.initialized = false;
  }

  finishLoading(accessories) {
    this.accessories = accessories;
    this.initialized = true;
  }

  async handle(target, name, active) {
    let result = {
      error: true,
      message: 'Homebridge not initialized.',
    };

    if (this.initialized) {
      const accessory = this.accessories.find((accessory) => accessory.displayName == name);

      if (accessory) {
        switch (target) {
          case 'motion':
            result = await this.motionHandler(accessory, active);
            break;
          case 'doorbell':
            result = await this.doorbellHandler(accessory, active);
            break;
          default:
            result = {
              error: true,
              message: `First directory level must be "motion" or "doorbell", got "${target}".`,
            };
        }
      } else {
        result = {
          error: true,
          message: `Camera "${name}" not found.`,
        };
      }
    }

    if (result.error) {
      this.log.error(`Handling event: ${result.message}`, name, 'Homebridge');
      return;
    }

    this.log.debug(`Handling event: ${result.message}`, name);
  }

  async motionHandler(accessory, active, manual) {
    const motionSensor = accessory.getService(this.hap.Service.MotionSensor);
    const motionTrigger = accessory.getServiceById(this.hap.Service.Switch, 'MotionTrigger');

    if (motionSensor) {
      const doorbellSensor = accessory.getService(this.hap.Service.Doorbell);
      const timeoutConfig = accessory.context.config.motionTimeout >= 0 ? accessory.context.config.motionTimeout : 1;
      const timeout = this.motionTimers.get(accessory.UUID);

      if (timeout) {
        if (active) {
          this.log.info('Motion ON (skip motion event, timeout active)', accessory.displayName);

          if (motionTrigger && manual) {
            setTimeout(() => motionTrigger.updateCharacteristic(this.hap.Characteristic.On, false), 500);
          }

          return {
            error: false,
            message: 'Skip motion event, timeout active!',
          };
        } else {
          clearTimeout(timeout);
          this.motionTimers.delete(accessory.UUID);
        }
      }

      if (manual) {
        const generalSettings = await this.cameraUi?.database?.interface?.get('settings').get('general').value();
        const atHome = generalSettings?.atHome || false;
        const cameraExcluded = (generalSettings?.exclude || []).includes(accessory.displayName);

        if (active && atHome && !cameraExcluded) {
          this.log.info(
            `Motion ON (skip motion event, at home is active and ${accessory.displayName} is not excluded)`,
            accessory.displayName
          );

          if (motionTrigger) {
            setTimeout(() => motionTrigger.updateCharacteristic(this.hap.Characteristic.On, false), 500);
          }

          return {
            error: false,
            message: `Skip motion trigger. At Home is active and ${accessory.displayName} is not excluded!`,
          };
        }

        this.log.info(`Motion ${active ? 'ON' : 'OFF'}`, accessory.displayName);

        if (!accessory.context.config.hsv) {
          this.cameraUi.eventController.triggerEvent('motion', accessory.displayName, active);
        }
      }

      motionSensor.updateCharacteristic(this.hap.Characteristic.MotionDetected, active ? true : false);
      motionTrigger?.updateCharacteristic(this.hap.Characteristic.On, active ? true : false);

      if (active) {
        if (accessory.context.config.motionDoorbell) {
          doorbellSensor?.updateCharacteristic(
            this.hap.Characteristic.ProgrammableSwitchEvent,
            this.hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS
          );
        }

        const timer = setTimeout(() => {
          this.log.info('Motion handler timeout.', accessory.displayName);

          this.motionTimers.delete(accessory.UUID);
          motionSensor.updateCharacteristic(this.hap.Characteristic.MotionDetected, false);

          if (motionTrigger) {
            motionTrigger.updateCharacteristic(this.hap.Characteristic.On, false);
          }
        }, timeoutConfig * 1000);

        this.motionTimers.set(accessory.UUID, timer);
      }

      return {
        error: false,
        message: `Motion switched ${active ? 'on' : 'off'}`,
      };
    } else {
      if (motionTrigger) {
        setTimeout(() => motionTrigger.updateCharacteristic(this.hap.Characteristic.On, false), 500);
      }

      return {
        error: true,
        message: 'Motion is not enabled for this camera.',
      };
    }
  }

  async doorbellHandler(accessory, active, manual) {
    const doorbellSensor = accessory.getService(this.hap.Service.Doorbell);
    const doorbellTrigger = accessory.getServiceById(this.hap.Service.Switch, 'DoorbellTrigger');

    if (doorbellSensor) {
      const timeoutConfig = accessory.context.config.motionTimeout >= 0 ? accessory.context.config.motionTimeout : 1;
      const timeout = this.doorbellTimers.get(accessory.UUID);

      if (timeout) {
        if (active) {
          this.log.info('Doorbell ON (skip doorbell event, doorbell timeout active)', accessory.displayName);

          if (doorbellTrigger && manual) {
            setTimeout(() => doorbellTrigger.updateCharacteristic(this.hap.Characteristic.On, false), 500);
          }

          return {
            error: false,
            message: 'Skip doorbell event, timeout active!',
          };
        } else {
          clearTimeout(timeout);
          this.doorbellTimers.delete(accessory.UUID);
        }
      }

      if (manual) {
        const generalSettings = await this.cameraUi?.database?.interface?.get('settings').get('general').value();
        const atHome = generalSettings?.atHome || false;
        const cameraExcluded = (generalSettings?.exclude || []).includes(accessory.displayName);

        if (active && atHome && !cameraExcluded) {
          this.log.info(
            `Doorbell ON (skip doorbell event, at home is active and ${accessory.displayName} is not excluded)`,
            accessory.displayName
          );

          if (doorbellTrigger) {
            setTimeout(() => doorbellTrigger.updateCharacteristic(this.hap.Characteristic.On, false), 500);
          }

          return {
            error: false,
            message: `Skip doorbell trigger. At Home is active and ${accessory.displayName} is not excluded!`,
          };
        }

        if (!accessory.context.config.hsv) {
          this.cameraUi.eventController.triggerEvent('doorbell', accessory.displayName, active);
        }
      }

      this.log.info(`Doorbell ${active ? 'ON' : 'OFF'}`, accessory.displayName);

      doorbellTrigger?.updateCharacteristic(this.hap.Characteristic.On, active ? true : false);

      if (active) {
        if (accessory.context.config.hsv) {
          this.motionHandler(accessory, active, manual);
        }

        doorbellSensor.updateCharacteristic(
          this.hap.Characteristic.ProgrammableSwitchEvent,
          this.hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS
        );

        const timer = setTimeout(() => {
          this.log.debug('Doorbell handler timeout.', accessory.displayName);

          this.doorbellTimers.delete(accessory.UUID);

          if (doorbellTrigger) {
            doorbellTrigger.updateCharacteristic(this.hap.Characteristic.On, false);
          }
        }, timeoutConfig * 1000);

        this.doorbellTimers.set(accessory.UUID, timer);
      }

      return {
        error: false,
        message: `Doorbell switched ${active ? 'on' : 'off'}`,
      };
    } else {
      if (doorbellTrigger) {
        setTimeout(() => doorbellTrigger.updateCharacteristic(this.hap.Characteristic.On, false), 500);
      }

      return {
        error: true,
        message: 'Doorbell is not enabled for this camera.',
      };
    }
  }
}

module.exports = Handler;
