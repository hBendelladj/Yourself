import { describe, it, expect, vi } from 'vitest';
import { AnimationStateManager } from '../src/core/animation/animationState';
import { IdleBehaviorController } from '../src/core/animation/idleBehavior';
import { AvatarStateMachine } from '../src/core/animation/stateMachine';
import { PoseDeformer } from '../src/core/render/poses';
import { LANDMARK_INDICES } from '../src/core/face/landmarkGroups';

describe('Animation and Idle Behavior', () => {
  it('AnimationStateManager applies smooth attack and release interpolation', () => {
    const manager = new AnimationStateManager();
    expect(manager.current.blink).toBe(0);

    manager.setTarget('blink', 1.0);
    expect(manager.target.blink).toBe(1.0);

    // Actualizar con un delta pequeño (~16 ms)
    manager.update(0.016);
    expect(manager.current.blink).toBeGreaterThan(0.0);
    expect(manager.current.blink).toBeLessThan(1.0);

    // Tras varios pasos, se aproxima asintóticamente a 1.0
    for (let i = 0; i < 20; i++) {
      manager.update(0.016);
    }
    expect(manager.current.blink).toBeGreaterThan(0.9);

    // Liberación hacia 0.0
    manager.setTarget('blink', 0.0);
    manager.update(0.016);
    expect(manager.current.blink).toBeLessThan(0.95);
  });

  it('IdleBehaviorController triggers natural blinks within expected intervals', () => {
    const manager = new AnimationStateManager();
    const idle = new IdleBehaviorController(manager);

    // Simular el avance del tiempo hasta que ocurra un parpadeo (máximo 6.5s)
    let hasBlinked = false;
    for (let step = 0; step < 400; step++) {
      idle.update(0.016, 'idle');
      if (manager.target.blink > 0.05) {
        hasBlinked = true;
        break;
      }
    }

    expect(hasBlinked).toBe(true);
  });

  it('IdleBehaviorController allows manual triggerBlink', () => {
    const manager = new AnimationStateManager();
    const idle = new IdleBehaviorController(manager);

    idle.triggerBlink();
    idle.update(0.016, 'idle');
    expect(manager.target.blink).toBeGreaterThan(0.0);
  });

  it('AvatarStateMachine correctly transitions and notifies listeners', () => {
    const sm = new AvatarStateMachine('idle');
    expect(sm.getMood()).toBe('idle');

    const listener = vi.fn();
    const unsubscribe = sm.onStateChange(listener);

    const changed = sm.transitionTo('listening');
    expect(changed).toBe(true);
    expect(sm.getMood()).toBe('listening');
    expect(listener).toHaveBeenCalledWith('listening', 'idle');

    // Intentar misma transición no debe disparar
    const changedAgain = sm.transitionTo('listening');
    expect(changedAgain).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    sm.transitionTo('thinking');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('PoseDeformer keeps the 16 border anchors completely fixed during deformation', () => {
    const vertexCount = 494; // 478 landmarks + 16 anchors
    const landmarkCount = 478;
    const basePositions = new Float32Array(vertexCount * 3);

    // Inicializar posiciones sintéticas
    for (let i = 0; i < vertexCount; i++) {
      basePositions[i * 3] = (i % 20) * 0.05 - 0.5;
      basePositions[i * 3 + 1] = Math.floor(i / 20) * 0.05 - 0.5;
      basePositions[i * 3 + 2] = 0;
    }

    const deformer = new PoseDeformer({
      basePositions,
      landmarkCount,
      vertexCount,
    });

    const currentPositions = new Float32Array(basePositions);

    // Aplicar deformaciones intensas: parpadeo, mandíbula, sonrisa, giro de cabeza
    deformer.apply(currentPositions, {
      blink: 1.0,
      blinkLeft: 1.0,
      blinkRight: 1.0,
      gazeX: 0.8,
      gazeY: -0.5,
      jawOpen: 1.0,
      mouthRound: 0.5,
      mouthWide: 0.5,
      smile: 0.8,
      browRaise: 0.7,
      headYaw: 0.05,
      headPitch: 0.05,
      headRoll: 0.04,
      breath: 1.0,
    });

    // 1. Las 16 anclas perimetrales (índices 478 a 493) deben permanecer 100% fijas
    for (let a = landmarkCount; a < vertexCount; a++) {
      expect(currentPositions[a * 3]).toBeCloseTo(basePositions[a * 3]!, 5);
      expect(currentPositions[a * 3 + 1]).toBeCloseTo(basePositions[a * 3 + 1]!, 5);
      expect(currentPositions[a * 3 + 2]).toBeCloseTo(basePositions[a * 3 + 2]!, 5);
    }

    // 2. El mentón debe haber descendido significativamente por jawOpen
    const chin = LANDMARK_INDICES.chinBottom;
    expect(currentPositions[chin * 3 + 1]).toBeLessThan(basePositions[chin * 3 + 1]!);

    // 3. Las comisuras deben haberse elevado por smile
    const leftCorner = LANDMARK_INDICES.lipLeftCorner;
    expect(currentPositions[leftCorner * 3 + 1]).not.toBe(basePositions[leftCorner * 3 + 1]!);
  });
});
